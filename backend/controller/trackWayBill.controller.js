const axios = require('axios');
const xml2js = require('xml2js');
const pool = require('../config/db');
const { logError } = require('../utils/errorLogger');

// Function to fetch and parse original request data from database
const getOriginalRequestData = async (waybillNo) => {
  let connection;
  
  try {
    connection = await pool.getConnection();
    
    // Find the original request by waybill number
    const query = `
      SELECT Request, Naquel_awb_number, awb_number
      FROM Naquel_awb 
      WHERE Naquel_awb_number = ? OR awb_number = ?
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    
    const [rows] = await connection.execute(query, [waybillNo, waybillNo]);
    
    if (rows.length === 0) {
      throw new Error(`No original request found for waybill: ${waybillNo}`);
    }
    
    const originalRequest = rows[0].Request;
    console.log(`📋 Found original request for waybill: ${waybillNo}`);
    
    // Parse the original XML request
    const parser = new xml2js.Parser({ explicitArray: false });
    const parsedRequest = await parser.parseStringPromise(originalRequest);
    
    // Extract relevant data from the original request
    const manifestDetails = parsedRequest['soap:Envelope']['soap:Body']['UpdateWaybill']['ManifestShipmentDetails'];
    const clientInfo = manifestDetails.ClientInfo;
    const clientAddress = clientInfo.ClientAddress;
    const clientContact = clientInfo.ClientContact;
    
    return {
      clientID: clientInfo.ClientID,
      password: clientInfo.Password,
      version: clientInfo.Version,
      phoneNumber: clientAddress.PhoneNumber,
      firstAddress: clientAddress.FirstAddress,
      countryCode: clientAddress.CountryCode,
      cityCode: clientAddress.CityCode,
      contactName: clientContact.Name,
      contactEmail: clientContact.Email,
      contactPhone: clientContact.PhoneNumber,
      consigneeName: manifestDetails.ConsigneeInfo.ConsigneeName,
      consigneeEmail: manifestDetails.ConsigneeInfo.Email,
      consigneePhone: manifestDetails.ConsigneeInfo.PhoneNumber,
      consigneeAddress: manifestDetails.ConsigneeInfo.Address,
      consigneeCountryCode: manifestDetails.ConsigneeInfo.CountryCode,
      consigneeCityCode: manifestDetails.ConsigneeInfo.CityCode,
      refNo: manifestDetails.RefNo,
      goodDesc: manifestDetails.GoodDesc,
      declareValue: manifestDetails.DeclareValue,
      weight: manifestDetails.Weight,
      pcs: manifestDetails.PicesCount,
      billingType: manifestDetails.BillingType,
      loadTypeID: manifestDetails.LoadTypeID
    };
    
  } catch (error) {
    console.error('Error fetching original request data:', error.message);
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// Function to generate tracking XML payload with original request data
const generateTrackingXml = (waybillNo, originalData) => {
  const xmlPayload = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <tns:TraceByWaybillNo xmlns:tns="http://tempuri.org/">
      <tns:ClientInfo>
        <tns:ClientAddress>
          <tns:PhoneNumber/>
          <tns:NationalAddress/>
          <tns:POBox/>
          <tns:ZipCode/>
          <tns:Fax/>
          <tns:Latitude/>
          <tns:Longitude/>
          <tns:ShipperName>${originalData.contactName}</tns:ShipperName>
          <tns:FirstAddress>${originalData.firstAddress}</tns:FirstAddress>
          <tns:Location>${originalData.contactName }</tns:Location>
          <tns:CountryCode>${originalData.countryCode }</tns:CountryCode>
          <tns:CityCode>${originalData.cityCode }</tns:CityCode>
        </tns:ClientAddress>
        <tns:ClientContact>
          <tns:Name>${originalData.contactName}</tns:Name>
          <tns:Email>${originalData.contactEmail }</tns:Email>
          <tns:PhoneNumber/>
        <tns:MobileNo/>
        </tns:ClientContact>
        <tns:ClientID>${process.env.NAQUEL_CLIENTID}</tns:ClientID>
        <tns:Password>${process.env.NAQUEL_PASSWORD}</tns:Password>
        <tns:Version>${process.env.NAQUEL_VERSION}</tns:Version>
      </tns:ClientInfo>
      <tns:WaybillNo>${waybillNo}</tns:WaybillNo>
    </tns:TraceByWaybillNo>
  </soap:Body>
</soap:Envelope>`;

  return xmlPayload;
};

const trackWayBill = async (req, res) => {
  let connection;
  
  try {
    // Validate request
    if (!req.body || !req.body.waybillNo) {
      // Log missing waybill error
      await logError({
        controllerName: 'trackWayBill',
        errorType: 'MISSING_WAYBILL_NO',
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'waybillNo is required',
        requestData: req.body,
        waybillNumber: null,
        httpStatus: 400,
        apiStatus: 'error',
        hasError: true,
        stackTrace: null
      });
      
      return res.status(400).json({
        success: false,
        message: 'waybillNo is required',
        error: 'MISSING_WAYBILL_NO',
        timestamp: new Date().toISOString()
      });
    }

    const { waybillNo } = req.body;
    
    console.log(`🔍 Tracking waybill: ${waybillNo}`);
    
    // Fetch original request data from database
    let originalData;
    try {
      originalData = await getOriginalRequestData(waybillNo);
      console.log('📋 Original request data extracted successfully');
    } catch (fetchError) {
      console.log(`⚠️  Could not fetch original request data: ${fetchError.message}`);
      console.log('🔄 Using default values for tracking request');
      originalData = {};
    }
    
    // Generate tracking XML payload with original data
    const xmlPayload = generateTrackingXml(waybillNo, originalData);
    
    // Log the XML request payload
    console.log('=== Tracking XML Request Payload ===');
    console.log(xmlPayload);
    
    // Headers for SOAP request with TraceByWaybillNo action
    const headers = {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'http://tempuri.org/TraceByWaybillNo'
    };

    // Make API call to Naquel
    console.log('Sending tracking request to Naquel API...');
    const response = await axios.post(process.env.NAQUEL_API, xmlPayload, { headers });
    
    console.log('Received tracking response from Naquel API');
    console.log('=== Raw Tracking Response ===');
    console.log('Status:', response.status);
    console.log('Response Data:', response.data);
    
    // Parse XML response
    const parser = new xml2js.Parser({ explicitArray: false });
    const parsedResponse = await parser.parseStringPromise(response.data);
    
    // Log the parsed response
    console.log('=== Parsed Tracking Response ===');
    console.log(JSON.stringify(parsedResponse, null, 2));
    
    // Extract tracking data from response
    const traceResult = parsedResponse['soap:Envelope']['soap:Body']['TraceByWaybillNoResponse']['TraceByWaybillNoResult'];
    const tracking = traceResult.Tracking;
    
    if (!tracking) {
      // Log no tracking data error
      await logError({
        controllerName: 'trackWayBill',
        errorType: 'NO_TRACKING_DATA',
        errorCode: 'TRACKING_NOT_FOUND',
        errorMessage: 'No tracking information found for this waybill',
        requestData: req.body,
        responseData: parsedResponse,
        waybillNumber: waybillNo,
        httpStatus: 404,
        apiStatus: 'error',
        hasError: true,
        stackTrace: null
      });
      
      return res.status(404).json({
        success: false,
        message: 'No tracking information found for this waybill',
        error: 'NO_TRACKING_DATA',
        waybillNo: waybillNo,
        timestamp: new Date().toISOString()
      });
    }
    
    // Extract required fields
    const trackingData = {
      date: tracking.Date || null,
      activity: tracking.Activity || null,
      waybillNo: tracking.WaybillNo || waybillNo,
      stationCode: tracking.StationCode || null,
      activityCode: tracking.ActivityCode || null,
      arabicActivity: tracking.ArabicActivity || null,
      clientID: tracking.ClientID || null,
      hasError: tracking.HasError === 'true',
      errorMessage: tracking.ErrorMessage || null,
      comments: tracking.Comments || null,
      refNo: tracking.RefNo || null,
      deliveryStatusID: tracking.DeliveryStatusID || null,
      eventCode: tracking.EventCode || null
    };
    
    console.log('=== Extracted Tracking Data ===');
    console.log(JSON.stringify(trackingData, null, 2));
    
    // Store tracking request in database
    connection = await pool.getConnection();
    
    const insertQuery = `
      INSERT INTO Naquel_awb 
      (awb_number, Request, Response, created_at) 
      VALUES (?, ?, ?, NOW())
    `;
    
    const [insertResult] = await connection.execute(insertQuery, [
      waybillNo,
      xmlPayload,
      response.data
    ]);
    
    const finalResponse = {
      success: true,
      message: 'Tracking information retrieved successfully',
      data: {
        waybillNo: trackingData.waybillNo,
        date: trackingData.date,
        activity: trackingData.activity,
        stationCode: trackingData.stationCode,
        activityCode: trackingData.activityCode,
        arabicActivity: trackingData.arabicActivity,
        refNo: trackingData.refNo,
        deliveryStatusID: trackingData.deliveryStatusID,
        eventCode: trackingData.eventCode,
        hasError: trackingData.hasError,
        errorMessage: trackingData.errorMessage,
        originalRequestData: Object.keys(originalData).length > 0 ? {
          consigneeName: originalData.consigneeName,
          consigneeEmail: originalData.consigneeEmail,
          consigneePhone: originalData.consigneePhone,
          consigneeAddress: originalData.consigneeAddress,
          consigneeCountryCode: originalData.consigneeCountryCode,
          consigneeCityCode: originalData.consigneeCityCode,
          refNo: originalData.refNo,
          goodDesc: originalData.goodDesc
        } : null,
        databaseId: insertResult.insertId
      },
      timestamp: new Date().toISOString()
    };
    
    // Log the final response
    console.log('=== Final Tracking Response ===');
    console.log(JSON.stringify(finalResponse, null, 2));
    
    res.json(finalResponse);

  } catch (error) {
    console.error('Error in trackWayBill:', error.message);
    
    if (error.response) {
      console.error('API Error Response:', error.response.data);
      console.error('Status:', error.response.status);
    } else if (error.request) {
      console.error('No response received:', error.request);
    } else {
      console.error('Request setup error:', error.message);
    }
    
    // Log system error
    await logError({
      controllerName: 'trackWayBill',
      errorType: 'SYSTEM_ERROR',
      errorCode: 'INTERNAL_ERROR',
      errorMessage: error.message,
      requestData: req.body,
      responseData: error.response?.data || null,
      waybillNumber: req.body?.waybillNo || null,
      httpStatus: 500,
      apiStatus: 'error',
      hasError: true,
      stackTrace: error.stack
    });
    
    // Store error in database if possible
    if (connection) {
      try {
        const errorInsertQuery = `
          INSERT INTO Naquel_awb 
          (awb_number, Request, Response, created_at) 
          VALUES (?, ?, ?, NOW())
        `;
        
        await connection.execute(errorInsertQuery, [
          (req.body && req.body.waybillNo) || null,
          JSON.stringify(req.body || {}),
          `ERROR: ${error.message}`
        ]);
      } catch (dbError) {
        console.error('Failed to store error in database:', dbError.message);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to track waybill',
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
  trackWayBill
};
