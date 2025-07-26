const express = require('express');
const router = express.Router();
const { createWayBill } = require('../controller/createWayBill.controller');
const { updateWayBill, getShipmentDataByAwb } = require('../controller/updateWayBill.controller');
const { getWayBillLabel } = require('../controller/getWayBillLabel.controller');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

// Route to create waybill using Naquel API
router.post('/create-waybill', createWayBill);

// Route to update waybill using Naquel API (Production endpoint)
// Expects: {"awb": "CUSTOMER_AWB_NUMBER"}
router.post('/update-waybill', updateWayBill);

// Route to update waybill using Naquel API (Test endpoint with direct JSON input)
// Expects: JSON object similar to sample.json format
router.post('/update-waybill-test', async (req, res) => {
  try {
    // Validate that request body contains shipment data
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Request body is required with shipment data',
        error: 'MISSING_REQUEST_BODY',
        example: {
          waybillNo: "300006227",
          sellerID: "unstoppablegems",
          consigneeFirstName: "ali",
          // ... other fields
        },
        timestamp: new Date().toISOString()
      });
    }

    // Validate required fields
    const requiredFields = ['sellerFirstName', 'consigneeFirstName', 'consigneeCity', 'consigneeCountryCode'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        error: 'MISSING_REQUIRED_FIELDS',
        missingFields: missingFields,
        timestamp: new Date().toISOString()
      });
    }

    console.log('=== Test Endpoint: Direct JSON Input ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    // Create a mock request object that mimics the database-driven approach
    const mockReq = {
      body: req.body // Use the JSON data directly
    };

    // Call the existing updateWayBill controller with the mock request
    await updateWayBill(mockReq, res);

  } catch (error) {
    console.error('Error in update-waybill-test endpoint:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to process test waybill update',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Route to update waybill using Naquel API (Test endpoint with direct JSON input and custom waybill)
// Expects: JSON object with waybillNo field that will be used directly
router.post('/update-waybill-test2', async (req, res) => {
  try {
    // Validate that request body contains shipment data
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Request body is required with shipment data',
        error: 'MISSING_REQUEST_BODY',
        timestamp: new Date().toISOString()
      });
    }

    // Validate required fields including waybillNo
    const requiredFields = ['waybillNo', 'sellerFirstName', 'consigneeFirstName', 'consigneeCity', 'consigneeCountryCode'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        error: 'MISSING_REQUIRED_FIELDS',
        missingFields: missingFields,
        timestamp: new Date().toISOString()
      });
    }

    console.log('=== Test Endpoint 2: Direct JSON Input with Custom Waybill ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log(`🎯 Using custom waybill: ${req.body.waybillNo}`);

    // Create a mock request object that indicates this is a custom waybill request
    const mockReq = {
      body: {
        ...req.body,
        _useCustomWaybill: true // Flag to indicate custom waybill usage
      }
    };

    // Call the existing updateWayBill controller with the mock request
    await updateWayBill(mockReq, res);

  } catch (error) {
    console.error('Error in update-waybill-test2 endpoint:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to process test waybill update with custom waybill',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Route to get waybill label by waybill number
router.get('/label/:waybillNo', getWayBillLabel);

// Route to view label as PDF in browser
router.get('/label/:waybillNo/pdf', async (req, res) => {
  try {
    const { waybillNo } = req.params;
    
    const connection = await pool.getConnection();
    const [rows] = await connection.execute(
      'SELECT Label FROM Naquel_awb WHERE Naquel_awb_number = ?',
      [waybillNo]
    );
    connection.release();

    if (rows.length === 0 || !rows[0].Label) {
      return res.status(404).json({
        success: false,
        message: 'Label not found for this waybill'
      });
    }

    // Convert base64 to buffer
    const pdfBuffer = Buffer.from(rows[0].Label, 'base64');
    
    // Set headers for PDF viewing
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="waybill-${waybillNo}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Send PDF
    res.send(pdfBuffer);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve PDF',
      error: error.message
    });
  }
});

// Route to download label as PDF file
router.get('/label/:waybillNo/download', async (req, res) => {
  try {
    const { waybillNo } = req.params;
    
    const connection = await pool.getConnection();
    const [rows] = await connection.execute(
      'SELECT Label FROM Naquel_awb WHERE Naquel_awb_number = ?',
      [waybillNo]
    );
    connection.release();

    if (rows.length === 0 || !rows[0].Label) {
      return res.status(404).json({
        success: false,
        message: 'Label not found for this waybill'
      });
    }

    // Convert base64 to buffer
    const pdfBuffer = Buffer.from(rows[0].Label, 'base64');
    
    // Set headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="waybill-${waybillNo}-label.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Send PDF for download
    res.send(pdfBuffer);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to download PDF',
      error: error.message
    });
  }
});







// Route to test with sample data
router.post('/test-waybill', async (req, res) => {
  // Sample data from sample.json
  const sampleData = {
    "slno": 1,
    "sellerID": "LEX",
    "sellerFirstName": "Yakub",
    "sellerLastName": "patel",
    "export_reference": "1000024211742",
    "sellerAddress": "FLAT NO 103 BASERA APT  NR GARDEN MILL  RAMPURA TUNKI SURAT 395003",
    "sellerCity": "Surat",
    "sellerState": "GJ",
    "sellerPincode": "395003",
    "sellercountrycode": "IN",
    "sellerMobile": "7405130687",
    "sellerEmail": "psarfraj50@gmail.com",
    "consigneeFirstName": "Maria N. Navarro",
    "consigneeLastName": "",
    "consigneeAddress": "Dream Palace Hotel Ajman room 206,",
    "consigneeCity": "Ajman",
    "consigneeState": "Ajman",
    "consigneePincode": "00000",
    "consigneeCountryCode": "AE",
    "consigneeMobile": "971554132512",
    "consigneeEmail": "00d01568f253877923f0@members.ebay.com",
    "serviceType": "Ship+",
    "product": "",
    "productDescription": "Loose Gemstone",
    "productType": "Sale of Goods",
    "productValue": "100",
    "productcurrency": "USD",
    "length": "17",
    "lengthUnit": "CMS",
    "breadth": "14.5",
    "breadthUnit": "CMS",
    "height": "1",
    "heightUnit": "CMS",
    "weight": 0.05,
    "weightUnit": "KGS",
    "quantity": "PCS",
    "Pcs": "4",
    "reference_id": "seema Order no. 03-10998-49860",
    "ShipmentCurrency": "USD",
    "Mode": "LIVE",
    "ERPID": null,
    "PickupDate": "2024-01-01 11:30:07",
    "BookingDate": "2024-01-01 11:30:07",
    "CSBVFlag": "true",
    "IGSTAmount": null,
    "GSTInvoiceNumber": "24BWQPP2938H2Z2",
    "InvoiceNumber": null,
    "InvoiceDate": null,
    "EXPORT_INV_DATE": "2024-01-01",
    "EXPORT_INV_NUMB": null,
    "WhetherAgainstBondOrUT": null,
    "WhetherExportUsingeCommerce": null,
    "WhetherSupplyforExportIsOnPaymentOfIGST": "No",
    "TermsOfInvoice": "CIF",
    "TermsOfInvoiceValue": "100",
    "EORI": null,
    "Items": [
      {
        "Item_Description": "Loose Gemstone",
        "Item_Unit": "4",
        "Item_Value": "100",
        "Unit_Value": "25.00",
        "Item_Weight": 0.05,
        "weightUnit": "KGS",
        "Vol_WeightL": "17",
        "Vol_WeightW": "14.5",
        "Vol_WeightH": "1",
        "Vol_Unit": "CMS",
        "HSCode": "71023100",
        "WhetherMEIS": "No",
        "CommodityType": null
      }
    ]
  };

  // Override req.body with sample data
  req.body = sampleData;
  
  // Call the createWayBill controller
  await createWayBill(req, res);
});

// Test endpoint to lookup city codes
router.post('/lookup-city', async (req, res) => {
  let connection;
  
  try {
    const { consigneeCity, consigneeState, consigneeCountryCode } = req.body;
    
    if (!consigneeCity || !consigneeCountryCode) {
      return res.status(400).json({
        success: false,
        message: 'consigneeCity and consigneeCountryCode are required'
      });
    }
    
    connection = await pool.getConnection();
    
    // Search results array to show the lookup process
    const searchResults = [];
    
    // First try: Direct search by city name and country
    let query = `
      SELECT CityCode, CityName, CountryCode 
      FROM Naquel_Pincodes 
      WHERE CityName = ? AND CountryCode = ?
      LIMIT 1
    `;
    
    let [rows] = await connection.execute(query, [consigneeCity, consigneeCountryCode]);
    searchResults.push({
      step: 1,
      description: `Direct city search: ${consigneeCity} in ${consigneeCountryCode}`,
      query: query,
      params: [consigneeCity, consigneeCountryCode],
      results: rows.length,
      match: rows[0] || null
    });
    
    if (rows.length > 0) {
      return res.json({
        success: true,
        cityCode: rows[0].CityCode,
        matchedCity: rows[0].CityName,
        matchType: 'Direct city match',
        searchResults: searchResults
      });
    }
    
    // Second try: Search by state/city combination
    if (consigneeState && consigneeState !== consigneeCity) {
      [rows] = await connection.execute(query, [consigneeState, consigneeCountryCode]);
      searchResults.push({
        step: 2,
        description: `State search: ${consigneeState} in ${consigneeCountryCode}`,
        query: query,
        params: [consigneeState, consigneeCountryCode],
        results: rows.length,
        match: rows[0] || null
      });
      
      if (rows.length > 0) {
        return res.json({
          success: true,
          cityCode: rows[0].CityCode,
          matchedCity: rows[0].CityName,
          matchType: 'State match',
          searchResults: searchResults
        });
      }
    }
    
    // Third try: Fuzzy search
    query = `
      SELECT CityCode, CityName, CountryCode 
      FROM Naquel_Pincodes 
      WHERE (CityName LIKE ? OR CityName LIKE ?) AND CountryCode = ?
      LIMIT 5
    `;
    
    [rows] = await connection.execute(query, [
      `%${consigneeCity}%`, 
      `%${consigneeState}%`, 
      consigneeCountryCode
    ]);
    
    searchResults.push({
      step: 3,
      description: `Fuzzy search: %${consigneeCity}% or %${consigneeState}% in ${consigneeCountryCode}`,
      query: query,
      params: [`%${consigneeCity}%`, `%${consigneeState}%`, consigneeCountryCode],
      results: rows.length,
      matches: rows
    });
    
    if (rows.length > 0) {
      return res.json({
        success: true,
        cityCode: rows[0].CityCode,
        matchedCity: rows[0].CityName,
        matchType: 'Fuzzy match',
        allMatches: rows,
        searchResults: searchResults
      });
    }
    
    // Fourth try: Default city for country
    query = `
      SELECT CityCode, CityName, CountryCode 
      FROM Naquel_Pincodes 
      WHERE CountryCode = ?
      ORDER BY CityCode
      LIMIT 5
    `;
    
    [rows] = await connection.execute(query, [consigneeCountryCode]);
    searchResults.push({
      step: 4,
      description: `Default cities for ${consigneeCountryCode}`,
      query: query,
      params: [consigneeCountryCode],
      results: rows.length,
      matches: rows
    });
    
    if (rows.length > 0) {
      return res.json({
        success: true,
        cityCode: rows[0].CityCode,
        matchedCity: rows[0].CityName,
        matchType: 'Country default',
        availableCities: rows,
        searchResults: searchResults
      });
    }
    
    // No match found - return error instead of fallback
    res.status(404).json({
      success: false,
      message: `No city code found for ${consigneeCity}, ${consigneeState} in ${consigneeCountryCode}`,
      error: 'CITY_NOT_FOUND',
      searchResults: searchResults,
      suggestion: 'Please check if the city exists in Naquel coverage area or try a different city name'
    });
    
  } catch (error) {
    console.error('Error in city lookup:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to lookup city code',
      error: error.message
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Get all available cities for a country
router.get('/cities/:countryCode', async (req, res) => {
  let connection;
  
  try {
    const { countryCode } = req.params;
    connection = await pool.getConnection();
    
    const query = `
      SELECT CityCode, CityName, CountryCode, StationID, StationCode
      FROM Naquel_Pincodes 
      WHERE CountryCode = ?
      ORDER BY CityName
    `;
    
    const [rows] = await connection.execute(query, [countryCode.toUpperCase()]);
    
    res.json({
      success: true,
      countryCode: countryCode.toUpperCase(),
      totalCities: rows.length,
      cities: rows
    });
    
  } catch (error) {
    console.error('Error fetching cities:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cities',
      error: error.message
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Route to list available customer shipments for testing
router.get('/customer-shipments', async (req, res) => {
  let connection;
  
  try {
    connection = await pool.getConnection();
    
    const query = `
      SELECT 
        id,
        awb_number,
        order_id,
        customer_id,
        created_at,
        status,
        CASE 
          WHEN payload IS NOT NULL THEN 'Available'
          ELSE 'No Payload'
        END as payload_status,
        CHAR_LENGTH(payload) as payload_size
      FROM customer_shippments 
      WHERE payload IS NOT NULL 
      ORDER BY created_at DESC 
      LIMIT 20
    `;
    
    const [rows] = await connection.execute(query);
    
    res.json({
      success: true,
      message: 'Available customer shipments with payload data',
      totalFound: rows.length,
      shipments: rows,
      usage: {
        endpoint: '/update-waybill',
        method: 'POST',
        body: { awb: "AWB_NUMBER_FROM_LIST" },
        example: rows.length > 0 ? { awb: rows[0].awb_number } : { awb: "1000024460901" }
      }
    });
    
  } catch (error) {
    console.error('Error fetching customer shipments:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer shipments',
      error: error.message
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Route to check specific customer shipment data
router.get('/customer-shipment/:awb', async (req, res) => {
  try {
    const { awb } = req.params;
    
    console.log(`🔍 Checking shipment data for AWB: ${awb}`);
    
    const shipmentData = await getShipmentDataByAwb(awb);
    
    res.json({
      success: true,
      message: 'Shipment data found',
      shipment: {
        id: shipmentData.shipmentId,
        awb: shipmentData.awbNumber,
        orderId: shipmentData.orderId,
        customerId: shipmentData.customerId,
        payloadPreview: {
          sellerID: shipmentData.payload.sellerID || 'N/A',
          consigneeFirstName: shipmentData.payload.consigneeFirstName || 'N/A',
          consigneeCity: shipmentData.payload.consigneeCity || 'N/A',
          consigneeCountryCode: shipmentData.payload.consigneeCountryCode || 'N/A',
          productDescription: shipmentData.payload.productDescription || 'N/A',
          productValue: shipmentData.payload.productValue || 'N/A'
        },
        fullPayload: shipmentData.payload
      },
      usage: {
        toProcessShipment: {
          endpoint: '/update-waybill',
          method: 'POST',
          body: { awb: awb }
        }
      }
    });
    
  } catch (error) {
    res.status(404).json({
      success: false,
      message: 'Shipment not found or invalid payload',
      error: error.message,
      awb: req.params.awb
    });
  }
});

module.exports = router; 