const axios = require('axios');
const xml2js = require('xml2js');
const pool = require('../config/db');
const { logError } = require('../utils/errorLogger');

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
      console.log(`Found direct city match for label: ${rows[0].CityName} -> ${rows[0].CityCode}`);
      return rows[0].CityCode;
    }
    
    // Second try: Search by state/city combination
    if (consigneeState && consigneeState !== consigneeCity) {
      [rows] = await connection.execute(query, [consigneeState, consigneeCountryCode]);
      
      if (rows.length > 0) {
        console.log(`Found state match for label: ${rows[0].CityName} -> ${rows[0].CityCode}`);
        return rows[0].CityCode;
      }
    }
    
    // Third try: Fuzzy search
    query = `
      SELECT CityCode, CityName, CountryCode 
      FROM Naquel_Pincodes 
      WHERE (CityName LIKE ? OR CityName LIKE ?) AND CountryCode = ?
      LIMIT 1
    `;
    
    [rows] = await connection.execute(query, [
      `%${consigneeCity}%`, 
      `%${consigneeState}%`, 
      consigneeCountryCode
    ]);
    
    if (rows.length > 0) {
      console.log(`Found fuzzy match for label: ${rows[0].CityName} -> ${rows[0].CityCode}`);
      return rows[0].CityCode;
    }
    
    // Fourth try: Get any city for the country
    query = `
      SELECT CityCode, CityName, CountryCode 
      FROM Naquel_Pincodes 
      WHERE CountryCode = ?
      ORDER BY CityCode
      LIMIT 1
    `;
    
    [rows] = await connection.execute(query, [consigneeCountryCode]);
    
    if (rows.length > 0) {
      console.log(`Using any available city for country ${consigneeCountryCode}: ${rows[0].CityName} -> ${rows[0].CityCode}`);
      return rows[0].CityCode;
    }
    
    // If no match found in database, return null
    console.log(`No city code found in database for ${consigneeCity}, ${consigneeState}, ${consigneeCountryCode}`);
    return null;
    
  } catch (error) {
    console.error('Error looking up city code for label:', error.message);
    return null;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// Function to get waybill sticker/label
const getWaybillSticker = async (shipmentData, waybillNo) => {
  const stickerXmlPayload = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
        <tns:GetWaybillSticker xmlns:tns="http://tempuri.org/">
            <tns:clientInfo>
            <tns:ClientAddress>
                    <tns:PhoneNumber/>
                    <tns:NationalAddress/>
                    <tns:POBox/>
                    <tns:ZipCode/>
                    <tns:Fax/>
                    <tns:Latitude/>
                    <tns:Longitude/>
                    <tns:ShipperName>${shipmentData.sellerFirstName} ${shipmentData.sellerLastName}</tns:ShipperName>
                    <tns:FirstAddress>.</tns:FirstAddress>
                    <tns:Location>.</tns:Location>
                    <tns:CountryCode>AE</tns:CountryCode>
                    <tns:CityCode>DXB</tns:CityCode>
                </tns:ClientAddress>
                <tns:ClientContact>
                    <tns:Name>${shipmentData.sellerFirstName} ${shipmentData.sellerLastName}</tns:Name>
                    <tns:Email>${shipmentData.sellerEmail}</tns:Email>
                    <tns:PhoneNumber>${shipmentData.sellerMobile}</tns:PhoneNumber>
                    <tns:MobileNo>${shipmentData.sellerMobile}</tns:MobileNo>
                </tns:ClientContact>
                <tns:ClientID>${process.env.NAQUEL_CLIENTID}</tns:ClientID>
                <tns:Password>${process.env.NAQUEL_PASSWORD}</tns:Password>
                <tns:Version>${process.env.NAQUEL_VERSION}</tns:Version>
            </tns:clientInfo>
            <tns:WaybillNo>${waybillNo}</tns:WaybillNo>
            <tns:StickerSize>ExpressLabel4x6Inches</tns:StickerSize>
        </tns:GetWaybillSticker>
    </soap:Body>
</soap:Envelope>`;

  const stickerHeaders = {
    'Content-Type': 'text/xml; charset=utf-8',
    'SOAPAction': 'http://tempuri.org/GetWaybillSticker'
  };

  console.log('Sticker XML Payload:');
  console.log(stickerXmlPayload);

  const stickerResponse = await axios.post(process.env.NAQUEL_API, stickerXmlPayload, { headers: stickerHeaders });
  
  // Parse XML response for sticker
  const parser = new xml2js.Parser({ explicitArray: false });
  const parsedStickerResponse = await parser.parseStringPromise(stickerResponse.data);
  
  // Extract the label data
  const stickerResult = parsedStickerResponse['soap:Envelope']['soap:Body']['GetWaybillStickerResponse']['GetWaybillStickerResult'];
  
  return stickerResult;
};

// Controller function to get waybill label by waybill number
const getWayBillLabel = async (req, res) => {
  let connection;
  
  try {
    const { waybillNo } = req.params;
    
    if (!waybillNo) {
      // Log missing waybill error
      await logError({
        controllerName: 'getWayBillLabel',
        errorType: 'MISSING_WAYBILL_NO',
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'Waybill number is required',
        requestData: req.params,
        waybillNumber: null,
        httpStatus: 400,
        apiStatus: 'error',
        hasError: true,
        stackTrace: null
      });
      
      return res.status(400).json({
        success: false,
        message: 'Waybill number is required',
        timestamp: new Date().toISOString()
      });
    }

    // Get shipment data from database
    connection = await pool.getConnection();
    const [rows] = await connection.execute(
      'SELECT * FROM Naquel_awb WHERE Naquel_awb_number = ?',
      [waybillNo]
    );

    if (rows.length === 0) {
      // Log waybill not found error
      await logError({
        controllerName: 'getWayBillLabel',
        errorType: 'WAYBILL_NOT_FOUND',
        errorCode: 'WAYBILL_NOT_EXISTS',
        errorMessage: 'Waybill not found',
        requestData: req.params,
        waybillNumber: waybillNo,
        httpStatus: 404,
        apiStatus: 'error',
        hasError: true,
        stackTrace: null
      });
      
      return res.status(404).json({
        success: false,
        message: 'Waybill not found',
        timestamp: new Date().toISOString()
      });
    }

    const waybillRecord = rows[0];
    
    // If label already exists, return it
    if (waybillRecord.Label) {
      return res.status(200).json({
        success: true,
        message: 'Label retrieved from database',
        data: {
          waybillNo: waybillNo,
          label: waybillRecord.Label,
          source: 'database'
        },
        timestamp: new Date().toISOString()
      });
    }

    // If no label in database, fetch from API
    // Parse the stored XML request to extract shipment data
    const parser = new xml2js.Parser({ explicitArray: false });
    const parsedRequest = await parser.parseStringPromise(waybillRecord.Request);
    
    // Extract shipment data from the stored XML request
    const clientInfo = parsedRequest['soap:Envelope']['soap:Body']['CreateWaybill']['_ManifestShipmentDetails']['ClientInfo'];
    const shipmentData = {
      sellerFirstName: clientInfo.ClientContact.Name.split(' ')[0] || 'Shipper',
      sellerLastName: clientInfo.ClientContact.Name.split(' ')[1] || 'Name', 
      sellerEmail: clientInfo.ClientContact.Email,
      sellerMobile: clientInfo.ClientContact.PhoneNumber,
      sellerAddress: clientInfo.ClientAddress.FirstAddress,
      sellerCity: clientInfo.ClientAddress.FirstAddress
    };
    
    console.log('Fetching fresh label from Naquel API for:', waybillNo);
    let labelData;
    try {
      labelData = await getWaybillSticker(shipmentData, waybillNo);
      
      // Update database with new label
      await connection.execute(
        'UPDATE Naquel_awb SET Label = ? WHERE Id = ?',
        [labelData, waybillRecord.Id]
      );
    } catch (stickerError) {
      // Log sticker fetch error
      await logError({
        controllerName: 'getWayBillLabel',
        errorType: 'STICKER_FETCH_ERROR',
        errorCode: 'LABEL_FETCH_FAILED',
        errorMessage: stickerError.message,
        requestData: { waybillNo, shipmentData },
        responseData: stickerError.response?.data || null,
        waybillNumber: waybillNo,
        httpStatus: 500,
        apiStatus: 'error',
        hasError: true,
        stackTrace: stickerError.stack
      });
      
      throw stickerError; // Re-throw to be handled by main catch block
    }

    res.status(200).json({
      success: true,
      message: 'Label fetched and stored successfully',
      data: {
        waybillNo: waybillNo,
        label: labelData,
        source: 'api'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting waybill label:', error.message);
    
    // Log system error
    await logError({
      controllerName: 'getWayBillLabel',
      errorType: 'SYSTEM_ERROR',
      errorCode: 'INTERNAL_ERROR',
      errorMessage: error.message,
      requestData: req.params,
      responseData: error.response?.data || null,
      waybillNumber: req.params?.waybillNo || null,
      httpStatus: 500,
      apiStatus: 'error',
      hasError: true,
      stackTrace: error.stack
    });
    
    res.status(500).json({
      success: false,
      message: 'Failed to get waybill label',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

module.exports = {
  getWaybillSticker,
  getWayBillLabel
};
