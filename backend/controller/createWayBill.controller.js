const axios = require('axios');
const xml2js = require('xml2js');
const pool = require('../config/db');
const { getWaybillSticker } = require('./getWayBillLabel.controller');

// Function to generate export reference number in format LEX-XXXXXXXXXX
const generateExportReference = async () => {
  let connection;
  
  try {
    connection = await pool.getConnection();
    
    let isUnique = false;
    let exportReference;
    
    // Keep generating until we find a unique export reference
    while (!isUnique) {
      const randomNumber = Math.floor(1000000000 + Math.random() * 9000000000); // Generate 10-digit random number
      exportReference = `LEX-${randomNumber}`;
      
      // Check if this export reference already exists
      const checkQuery = `
        SELECT COUNT(*) as count 
        FROM Naquel_awb 
        WHERE awb_number = ?
      `;
      
      const [rows] = await connection.execute(checkQuery, [exportReference]);
      
      if (rows[0].count === 0) {
        isUnique = true;
        console.log(`Generated unique export reference: ${exportReference}`);
      } else {
        console.log(`Export reference ${exportReference} already exists, generating new one...`);
      }
    }
    
    return exportReference;
    
  } catch (error) {
    console.error('Error generating unique export reference:', error.message);
    // Fallback to basic generation if database check fails
    const randomNumber = Math.floor(1000000000 + Math.random() * 9000000000);
    return `LEX-${randomNumber}`;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// Function to lookup city code from Naquel_Pincodes table
const lookupCityCode = async (consigneeCity, consigneeState, consigneeCountryCode) => {
  let connection;
  
  try {
    connection = await pool.getConnection();
    
    // First try: Direct search by city name and country
    let query = `
      SELECT CityCode, CityName, CountryCode 
      FROM Naquel_Pincodes 
      WHERE CityName = ? AND CountryCode = ?
      LIMIT 1
    `;
    
    let [rows] = await connection.execute(query, [consigneeCity, consigneeCountryCode]);
    
    if (rows.length > 0) {
      console.log(`Found exact city match: ${rows[0].CityName} -> ${rows[0].CityCode}`);
      return rows[0].CityCode;
    }
    
    // Second try: Search by state name if provided and different from city
    if (consigneeState && consigneeState !== consigneeCity) {
      query = `
        SELECT CityCode, CityName, CountryCode 
        FROM Naquel_Pincodes 
        WHERE CityName = ? AND CountryCode = ?
        LIMIT 1
      `;
      
      [rows] = await connection.execute(query, [consigneeState, consigneeCountryCode]);
      
      if (rows.length > 0) {
        console.log(`Found exact state match: ${rows[0].CityName} -> ${rows[0].CityCode}`);
        return rows[0].CityCode;
      }
    }
    
    // No exact match found - throw error
    const errorMessage = `cityCode not found for city: ${consigneeCity}, state: ${consigneeState}, country: ${consigneeCountryCode}`;
    console.log(errorMessage);
    throw new Error(errorMessage);
    
  } catch (error) {
    console.error('Error looking up city code:', error.message);
    throw error; // Re-throw the error to be handled by calling function
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

const createWayBill = async (req, res) => {
  let connection;
  
  try {
    const shipmentData = req.body;
    
    // Generate export_reference if not provided
    if (!shipmentData.export_reference) {
      shipmentData.export_reference = await generateExportReference();
      console.log(`Generated export_reference: ${shipmentData.export_reference}`);
    }
    
    // Log the incoming request
    console.log('=== Incoming Request ===');
    console.log('Request body:', JSON.stringify(shipmentData, null, 2));
    
    // Lookup city code before creating XML
    let cityCode;
    try {
      cityCode = await lookupCityCode(
        shipmentData.consigneeCity,
        shipmentData.consigneeState,
        shipmentData.consigneeCountryCode
      );
    } catch (cityError) {
      return res.status(400).json({
        success: false,
        message: cityError.message,
        error: 'CITY_NOT_FOUND',
        availableCountries: ['AE', 'KSA', 'KW', 'BH', 'JO', 'CN', 'GB', 'HK'],
        timestamp: new Date().toISOString()
      });
    }
    
    console.log(`Using city code: ${cityCode} for ${shipmentData.consigneeCity}, ${shipmentData.consigneeState}, ${shipmentData.consigneeCountryCode}`);
    
    // Map JSON data to XML payload with dynamic city code
    const xmlPayload = mapJsonToXml(shipmentData, cityCode);
    
    // Log the XML request payload
    console.log('=== XML Request Payload ===');
    console.log(xmlPayload);
    
    // Headers for SOAP request
    const headers = {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'http://tempuri.org/CreateWaybill'
    };

        // Make API call to Naquel
    console.log('Sending request to Naquel API...');
    const response = await axios.post(process.env.NAQUEL_API, xmlPayload, { headers });
    
    console.log('Received response from Naquel API');
    console.log('=== Raw API Response ===');
    console.log('Status:', response.status);
    console.log('Headers:', JSON.stringify(response.headers, null, 2));
    console.log('Response Data:', response.data);
    
    // Parse XML response
    const parser = new xml2js.Parser({ explicitArray: false });
    const parsedResponse = await parser.parseStringPromise(response.data);
    
    // Log the parsed response
    console.log('=== Parsed XML Response ===');
    console.log(JSON.stringify(parsedResponse, null, 2));
    
    // Extract data from response
    const createWaybillResult = parsedResponse['soap:Envelope']['soap:Body']['CreateWaybillResponse']['CreateWaybillResult'];
    const naquelAwbNumber = createWaybillResult.WaybillNo || null;
    const naquelBookingRefNo = createWaybillResult.BookingRefNo || null;
    const hasError = createWaybillResult.HasError === 'true';
    const message = createWaybillResult.Message || '';
    
    // Log extracted data
    console.log('=== Extracted Response Data ===');
    console.log('AWB Number:', naquelAwbNumber);
    console.log('Booking Ref No:', naquelBookingRefNo);
    console.log('Has Error:', hasError);
    console.log('Message:', message);

    // If there's an error in the response, don't store in database and return error
    if (hasError) {
      console.log('Naquel API returned error:', message);
      
      const errorResponse = {
        success: false,
        message: message,
        error: 'NAQUEL_API_ERROR',
        data: {
          hasError: true,
          cityCodeUsed: cityCode
        },
        timestamp: new Date().toISOString()
      };
      
      // Log the error response
      console.log('=== Final Error Response ===');
      console.log(JSON.stringify(errorResponse, null, 2));
      
      return res.status(400).json(errorResponse);
    }

    // Store in database only if there's no error
    connection = await pool.getConnection();
    
    const insertQuery = `
      INSERT INTO Naquel_awb 
      (awb_number, Naquel_awb_number, Naquel_BookingRefNo, Request, Response, created_at) 
      VALUES (?, ?, ?, ?, ?, NOW())
    `;
    
    const [insertResult] = await connection.execute(insertQuery, [
      shipmentData.export_reference || null,
      naquelAwbNumber,
      naquelBookingRefNo,
      xmlPayload,
      response.data
    ]);

    // Get the label since waybill creation was successful
    let labelData = null;
    if (naquelAwbNumber) {
      try {
        console.log('Fetching waybill label...');
        labelData = await getWaybillSticker(shipmentData, naquelAwbNumber);
        
        if (labelData) {
          // Update the record with label data
          const updateQuery = `
            UPDATE Naquel_awb 
            SET Label = ? 
            WHERE id = ?
          `;
          await connection.execute(updateQuery, [labelData, insertResult.insertId]);
          console.log('Label data stored successfully');
        }
      } catch (labelError) {
        console.error('Failed to fetch waybill label:', labelError.message);
        // Don't fail the main operation if label fetch fails
      }
    }

    const finalResponse = {
      success: true,
      message: message,
      data: {
        waybillNo: naquelAwbNumber,
        bookingRefNo: naquelBookingRefNo,
        hasError: false,
        cityCodeUsed: cityCode,
        labelAvailable: !!labelData,
        databaseId: insertResult.insertId
      },
      timestamp: new Date().toISOString()
    };
    
    // Log the final response
    console.log('=== Final Success Response ===');
    console.log(JSON.stringify(finalResponse, null, 2));
    
    res.json(finalResponse);

  } catch (error) {
    console.error('Error in createWayBill:', error.message);
    
    if (error.response) {
      console.error('API Error Response:', error.response.data);
      console.error('Status:', error.response.status);
    } else if (error.request) {
      console.error('No response received:', error.request);
    } else {
      console.error('Request setup error:', error.message);
    }
    
    // Store error in database if possible
    if (connection) {
      try {
        const errorInsertQuery = `
          INSERT INTO Naquel_awb 
          (awb_number, Request, Response, created_at) 
          VALUES (?, ?, ?, NOW())
        `;
        
        await connection.execute(errorInsertQuery, [
          req.body.export_reference || null,
          JSON.stringify(req.body),
          `ERROR: ${error.message}`
        ]);
      } catch (dbError) {
        console.error('Failed to store error in database:', dbError.message);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create waybill',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// Function to map JSON data to XML payload
const mapJsonToXml = (data, cityCode) => {
  const xmlPayload = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <CreateWaybill xmlns="http://tempuri.org/">
      <_ManifestShipmentDetails>
        <ClientInfo>
          <ClientID>${process.env.NAQUEL_CLIENTID}</ClientID>
          <Password>${process.env.NAQUEL_PASSWORD}</Password>
          <Version>${process.env.NAQUEL_VERSION}</Version>
          <ClientAddress>
            <PhoneNumber>${data.sellerMobile}</PhoneNumber>
            <FirstAddress>N/A</FirstAddress>
            <CountryCode>${data.consigneeCountryCode}</CountryCode>
            <CityCode>${cityCode}</CityCode>
          </ClientAddress>
          <ClientContact>
            <Name>${data.consigneeFirstName} ${data.consigneeLastName}</Name>
            <Email>${data.consigneeEmail}</Email>
            <PhoneNumber>${data.consigneeMobile}</PhoneNumber>
          </ClientContact>
        </ClientInfo>
        <ConsigneeInfo>
          <ConsigneeName>${data.consigneeFirstName} ${data.consigneeLastName}</ConsigneeName>
          <Email>${data.consigneeEmail}</Email>
          <PhoneNumber>${data.consigneeMobile}</PhoneNumber>
          <Address>${data.consigneeAddress}</Address>
          <CountryCode>${data.consigneeCountryCode}</CountryCode>
          <CityCode>${cityCode}</CityCode>
        </ConsigneeInfo>
        <_CommercialInvoice>
          <CommercialInvoiceDetailList>
            <Quantity>${data.Pcs}</Quantity>
            <UnitType>${data.quantity}</UnitType>
            <CountryofManufacture>${data.sellercountrycode}</CountryofManufacture>
            <Description>${data.productDescription}</Description>
            <UnitCost>${data.productValue}</UnitCost>
            <CustomsCommodityCode>${data.Items && data.Items[0] ? data.Items[0].HSCode : ''}</CustomsCommodityCode>
            <Currency>${data.productcurrency}</Currency>
          </CommercialInvoiceDetailList>
          <InvoiceNo>${data.GSTInvoiceNumber}</InvoiceNo>
        </_CommercialInvoice>
        <BillingType>1</BillingType> 
        <PicesCount>${data.Pcs}</PicesCount>
        <Weight>${data.weight}</Weight>
        <CODCharge>0</CODCharge>
        <LoadTypeID>${process.env.NAQUEL_LOADTYPEID}</LoadTypeID>
        <RefNo>${data.export_reference}</RefNo>
        <DeclareValue>${data.productValue}</DeclareValue>
        <GoodDesc>${data.productDescription}</GoodDesc>
        <InsuredValue>0</InsuredValue>
        <GeneratePiecesBarCodes>true</GeneratePiecesBarCodes>
        <CreateBooking>true</CreateBooking>
        <PickUpPoint>${data.sellerCity}</PickUpPoint> <!--- optional -->
        <CustomDutyAmount>0</CustomDutyAmount>
        <GoodsVATAmount>0</GoodsVATAmount>
        <IsCustomDutyPayByConsignee>false</IsCustomDutyPayByConsignee>
         <CurrenyID>4</CurrenyID>
        <IsRTO>false</IsRTO>
      </_ManifestShipmentDetails>
    </CreateWaybill>
  </soap:Body>
</soap:Envelope>`;

  return xmlPayload;
};



module.exports = {
  createWayBill,
  generateExportReference
};
