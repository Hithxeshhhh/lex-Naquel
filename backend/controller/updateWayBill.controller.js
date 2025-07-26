const axios = require('axios');
const xml2js = require('xml2js');
const pool = require('../config/db');
const { getWaybillSticker } = require('./getWayBillLabel.controller');
const waybillManager = require('../services/waybill/waybillManager');

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

// Function to get USD exchange rate from database
const getUSDExchangeRate = async () => {
  let connection;
  
  try {
    connection = await pool.getConnection();
    
    const query = `
      SELECT exchange_rate 
      FROM currency_rates 
      WHERE currency_type = 'USD' 
      ORDER BY updated_at DESC 
      LIMIT 1
    `;
    
    const [rows] = await connection.execute(query);
    
    if (rows.length > 0) {
      console.log(`Found USD exchange rate: ${rows[0].exchange_rate}`);
      return parseFloat(rows[0].exchange_rate);
    } else {
      console.log('No USD exchange rate found, using default rate of 83');
      return 83; // Default INR to USD rate as fallback
    }
    
  } catch (error) {
    console.error('Error fetching USD exchange rate:', error.message);
    return 83; // Default fallback rate
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// Function to convert currency to USD
const convertToUSD = async (amount, fromCurrency) => {
  if (!amount || amount <= 0) return 0;
  
  // If already in USD, return as is
  if (fromCurrency === 'USD') {
    return parseFloat(amount);
  }
  
  // Convert INR to USD
  if (fromCurrency === 'INR') {
    const usdRate = await getUSDExchangeRate();
    const convertedAmount = parseFloat(amount) / usdRate;
    console.log(`Converting ${amount} ${fromCurrency} to USD: ${convertedAmount.toFixed(2)} (rate: ${usdRate})`);
    return parseFloat(convertedAmount.toFixed(2));
  }
  
  // For other currencies, return original amount (can be extended later)
  console.log(`Currency ${fromCurrency} not supported for conversion, using original amount`);
  return parseFloat(amount);
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

// Function to fetch shipment data from customer_shippments table
const getShipmentDataByAwb = async (awbNumber) => {
  let connection;
  
  try {
    connection = await pool.getConnection();
    
    const query = `
      SELECT id, awb_number, payload, order_id, customer_id
      FROM customer_shippments 
      WHERE awb_number = ?
      LIMIT 1
    `;
    
    const [rows] = await connection.execute(query, [awbNumber]);
    
    if (rows.length === 0) {
      throw new Error(`No shipment found with AWB number: ${awbNumber}`);
    }
    
    const shipment = rows[0];
    
    // Parse the payload JSON
    let parsedPayload;
    try {
      parsedPayload = JSON.parse(shipment.payload);
      console.log(`✅ Found shipment data for AWB: ${awbNumber} (Order ID: ${shipment.order_id})`);
    } catch (parseError) {
      throw new Error(`Invalid JSON in payload for AWB ${awbNumber}: ${parseError.message}`);
    }
    
    return {
      shipmentId: shipment.id,
      awbNumber: shipment.awb_number,
      orderId: shipment.order_id,
      customerId: shipment.customer_id,
      payload: parsedPayload
    };
    
  } catch (error) {
    console.error('Error fetching shipment data:', error.message);
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

const updateWayBill = async (req, res) => {
  let connection;
  
  try {
    // Ensure req.body exists
    if (!req.body) {
      return res.status(400).json({
        success: false,
        message: 'Request body is required',
        error: 'MISSING_REQUEST_BODY',
        timestamp: new Date().toISOString()
      });
    }

    // Determine if this is a database-driven request (has awb) or direct JSON request
    const isDatabaseDriven = req.body.awb && !req.body.sellerFirstName;
    const isDirectJson = req.body.sellerFirstName && req.body.consigneeFirstName;
    const isCustomWaybill = req.body._useCustomWaybill;

    if (!isDatabaseDriven && !isDirectJson && !isCustomWaybill) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request format. Either provide AWB number for database lookup or complete shipment data',
        error: 'INVALID_REQUEST_FORMAT',
        timestamp: new Date().toISOString()
      });
    }

    let customerShipment = null;
    let shipmentData = null;
    let allocatedWaybill = null;

    if (isDatabaseDriven) {
      // Database-driven approach (existing logic)
      console.log(`🔍 Looking up shipment data for AWB: ${req.body.awb}`);
      
      try {
        customerShipment = await getShipmentDataByAwb(req.body.awb);
        shipmentData = customerShipment.payload;
      } catch (fetchError) {
        return res.status(404).json({
          success: false,
          message: 'Shipment not found',
          error: 'SHIPMENT_NOT_FOUND',
          details: fetchError.message,
          awb: req.body.awb,
          timestamp: new Date().toISOString()
        });
      }
    } else if (isCustomWaybill) {
      // Custom waybill approach (new test endpoint 2)
      console.log('🎯 Using custom waybill from JSON input');
      shipmentData = req.body;
      
      // Create a mock allocated waybill object for consistency
      allocatedWaybill = {
        awb: shipmentData.waybillNo,
        id: null,
        vendor: 'NAQUEL',
        series: 'PRIME'
      };
      
      console.log(`✅ Using custom waybill: ${allocatedWaybill.awb}`);
    } else {
      // Direct JSON approach (existing test endpoint)
      console.log('📝 Using direct JSON input for shipment data');
      shipmentData = req.body;
    }
    
    // Generate export_reference if not provided
    if (!shipmentData.export_reference) {
      shipmentData.export_reference = await generateExportReference();
      console.log(`Generated export_reference: ${shipmentData.export_reference}`);
    }
    
    // Function to attempt waybill allocation with retry logic for database issues
    const attemptWaybillAllocation = async () => {
      let attempt = 0;
      
      while (true) {
        attempt++;
        console.log(`🎯 Waybill allocation attempt ${attempt}`);
        
        try {
          const allocatedWaybill = await waybillManager.getNextAvailableWaybill('NAQUEL', 'PRIME');
          console.log(`✅ Allocated waybill number: ${allocatedWaybill.awb} for shipment (attempt ${attempt})`);
          return { allocatedWaybill, attempt };
        } catch (waybillError) {
          console.error(`❌ Waybill allocation failed on attempt ${attempt}:`, waybillError.message);
          
          // If this is a "no waybills available" error, don't retry
          if (waybillError.message.includes('WAYBILL_LIMIT_REACHED') || 
              waybillError.message.includes('No waybill numbers configured')) {
            throw waybillError;
          }
          
          // Safety limit for database connection issues
          if (attempt >= 10) {
            throw new Error(`Failed to allocate waybill after ${attempt} attempts due to system issues: ${waybillError.message}`);
          }
          
          // Wait a bit before retrying for database connection issues
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    };

    // Execute initial waybill allocation (only for non-custom waybill cases)
    if (!isCustomWaybill) {
      let allocationResult;
      try {
        allocationResult = await attemptWaybillAllocation();
      } catch (allocationError) {
        // Check if this is a waybill limit reached error
        if (allocationError.message.includes('WAYBILL_LIMIT_REACHED')) {
          return res.status(400).json({
            success: false,
            message: 'Limit reached all wayBills are created',
            error: 'WAYBILL_LIMIT_REACHED',
            details: allocationError.message,
            timestamp: new Date().toISOString()
          });
        }
        
        return res.status(400).json({
          success: false,
          message: 'No available waybill numbers',
          error: 'WAYBILL_ALLOCATION_FAILED',
          details: allocationError.message,
          timestamp: new Date().toISOString()
        });
      }
      
      allocatedWaybill = allocationResult.allocatedWaybill;
    }
    shipmentData.waybillNo = allocatedWaybill.awb;
    
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
    
    // Convert currency to USD if needed
    let convertedProductValue = shipmentData.productValue;
    let finalCurrency = shipmentData.productcurrency || 'USD';
    
    if (shipmentData.productcurrency && shipmentData.productcurrency !== 'USD') {
      try {
        convertedProductValue = await convertToUSD(shipmentData.productValue, shipmentData.productcurrency);
        finalCurrency = 'USD';
        console.log(`Currency conversion: ${shipmentData.productValue} ${shipmentData.productcurrency} -> ${convertedProductValue} USD`);
        
        // Update shipmentData with converted values
        shipmentData.convertedProductValue = convertedProductValue;
        shipmentData.originalProductValue = shipmentData.productValue;
        shipmentData.originalCurrency = shipmentData.productcurrency;
        shipmentData.finalCurrency = finalCurrency;
      } catch (conversionError) {
        console.error('Error converting currency:', conversionError.message);
        // Use original values if conversion fails
        convertedProductValue = shipmentData.productValue;
        finalCurrency = shipmentData.productcurrency || 'USD';
        
        // Set the converted value even for failed conversion
        shipmentData.convertedProductValue = convertedProductValue;
        shipmentData.finalCurrency = finalCurrency;
      }
    } else {
      // Currency is already USD, no conversion needed
      console.log(`Currency is already USD, no conversion needed: ${shipmentData.productValue} ${shipmentData.productcurrency || 'USD'}`);
      shipmentData.convertedProductValue = parseFloat(shipmentData.productValue);
      shipmentData.finalCurrency = 'USD';
    }
    
    // Convert Unit_Value to USD if needed
    let convertedUnitValue = null;
    if (shipmentData.Items && shipmentData.Items.length > 0 && shipmentData.Items[0].Unit_Value) {
      const unitValue = parseFloat(shipmentData.Items[0].Unit_Value);
      
      if (shipmentData.productcurrency && shipmentData.productcurrency !== 'USD') {
        try {
          convertedUnitValue = await convertToUSD(unitValue, shipmentData.productcurrency);
          console.log(`Unit_Value currency conversion: ${unitValue} ${shipmentData.productcurrency} -> ${convertedUnitValue} USD`);
          
          // Store conversion details
          shipmentData.convertedUnitValue = convertedUnitValue;
          shipmentData.originalUnitValue = unitValue;
        } catch (conversionError) {
          console.error('Error converting Unit_Value currency:', conversionError.message);
          throw new Error(`Failed to convert Unit_Value from ${shipmentData.productcurrency} to USD: ${conversionError.message}`);
        }
      } else {
        // Currency is already USD, no conversion needed
        convertedUnitValue = unitValue;
        console.log(`Unit_Value is already in USD, no conversion needed: ${unitValue} USD`);
        shipmentData.convertedUnitValue = convertedUnitValue;
      }
    }
    
    // Determine LoadTypeID based on destination
    let loadTypeID;
    if (shipmentData.consigneeCountryCode === 'AE') {
      loadTypeID = '36'; // Domestic shipment within UAE
      console.log(`Domestic shipment detected: Country=${shipmentData.consigneeCountryCode} -> Using LoadTypeID: ${loadTypeID}`);
    } else {
      loadTypeID = '34'; // International shipment
      console.log(`International shipment detected: Country=${shipmentData.consigneeCountryCode} -> Using LoadTypeID: ${loadTypeID}`);
    }
    
    // Map JSON data to XML payload with dynamic city code and LoadTypeID
    const xmlPayload = mapJsonToXml(shipmentData, cityCode, loadTypeID);
    
    // Log the XML request payload
    console.log('=== XML Request Payload ===');
    console.log(xmlPayload);
    
    // Headers for SOAP request
    const headers = {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'http://tempuri.org/UpdateWaybill'
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
    const updateWaybillResult = parsedResponse['soap:Envelope']['soap:Body']['UpdateWaybillResponse']['UpdateWaybillResult'];
    const naquelAwbNumber = updateWaybillResult.WaybillNo || null;
    const naquelBookingRefNo = updateWaybillResult.BookingRefNo || null;
    const hasError = updateWaybillResult.HasError === 'true';
    const message = updateWaybillResult.Message || '';
    
    // Log extracted data
    console.log('=== Extracted Response Data ===');
    console.log('AWB Number:', naquelAwbNumber);
    console.log('Booking Ref No:', naquelBookingRefNo);
    console.log('Has Error:', hasError);
    console.log('Message:', message);

    // If there's an error in the response, don't store in database and return error
    if (hasError) {
      console.log('Naquel API returned error:', message);
      
      // Check if this is a "waybill already exists" error for retry logic
      if (message && message.toLowerCase().includes('waybill already exists')) {
        console.log(`⚠️  Waybill ${allocatedWaybill.awb} already exists in Naquel system, implementing retry logic...`);
        
        // Mark this waybill as used in our database (only if it was allocated from pool)
        if (!req.body._useCustomWaybill) {
          try {
            await waybillManager.markWaybillAsUsed(allocatedWaybill.awb, 'NAQUEL');
            console.log(`🔒 Marked waybill ${allocatedWaybill.awb} as used due to Naquel conflict`);
          } catch (markError) {
            console.error('Failed to mark waybill as used:', markError.message);
          }
        } else {
          console.log(`⚠️  Custom waybill ${allocatedWaybill.awb} already exists in Naquel system`);
        }
        
        // For custom waybill, don't retry - just return error
        if (req.body._useCustomWaybill) {
          return res.status(400).json({
            success: false,
            message: `Custom waybill ${allocatedWaybill.awb} already exists in Naquel system`,
            error: 'CUSTOM_WAYBILL_CONFLICT',
            data: {
              hasError: true,
              customWaybill: allocatedWaybill.awb,
              message: message
            },
            timestamp: new Date().toISOString()
          });
        }
        
        // Retry with new waybills until we find one that works (only for allocated waybills)
        let retryAttempt = 0;
        let retrySuccess = false;
        
        while (!retrySuccess) {
          retryAttempt++;
          console.log(`🔄 Retry attempt ${retryAttempt} - Getting new waybill...`);
          
          try {
            // Add a 0.5 second delay before each retry attempt
            await new Promise(resolve => setTimeout(resolve, 500));
            // Get a new waybill
            const newAllocation = await waybillManager.getNextAvailableWaybill('NAQUEL', 'PRIME');
            allocatedWaybill = newAllocation; // Update for final response
            shipmentData.waybillNo = newAllocation.awb;
            console.log(`✅ New waybill allocated: ${newAllocation.awb} (retry ${retryAttempt})`);
            
            // Create new XML payload with new waybill
            const retryXmlPayload = mapJsonToXml(shipmentData, cityCode, loadTypeID);
            
            // Headers for SOAP request
            const headers = {
              'Content-Type': 'text/xml; charset=utf-8',
              'SOAPAction': 'http://tempuri.org/UpdateWaybill'
            };

            // Make retry API call to Naquel
            console.log(`📡 Sending retry request to Naquel API (attempt ${retryAttempt})...`);
            const retryResponse = await axios.post(process.env.NAQUEL_API, retryXmlPayload, { headers });
            
            // Parse retry response
            const retryParser = new xml2js.Parser({ explicitArray: false });
            const retryParsedResponse = await retryParser.parseStringPromise(retryResponse.data);
            
            // Extract retry response data
            const retryResult = retryParsedResponse['soap:Envelope']['soap:Body']['UpdateWaybillResponse']['UpdateWaybillResult'];
            const retryNaquelAwbNumber = retryResult.WaybillNo || null;
            const retryNaquelBookingRefNo = retryResult.BookingRefNo || null;
            const retryHasError = retryResult.HasError === 'true';
            const retryMessage = retryResult.Message || '';
            
            console.log(`📋 Retry API Response - Error: ${retryHasError}, Message: ${retryMessage}`);
            
            if (retryHasError && retryMessage && retryMessage.toLowerCase().includes('waybill already exists')) {
              // This waybill also already exists, mark it and try again
              console.log(`⚠️  Retry waybill ${newAllocation.awb} also exists, marking as used...`);
              try {
                await waybillManager.markWaybillAsUsed(newAllocation.awb, 'NAQUEL');
              } catch (markRetryError) {
                console.error('Failed to mark retry waybill as used:', markRetryError.message);
              }
              continue; // Try next waybill
            } else if (retryHasError) {
              // Different error, release waybill and exit retry loop
              try {
                await waybillManager.releaseWaybill(newAllocation.awb, 'NAQUEL');
                console.log(`🔄 Released retry waybill ${newAllocation.awb} due to API error`);
              } catch (releaseError) {
                console.error('Failed to release retry waybill:', releaseError.message);
              }
              break; // Exit retry loop with error
            } else {
              // Success! Update variables for final processing
              console.log(`🎉 Retry successful with waybill ${newAllocation.awb}`);
              naquelAwbNumber = retryNaquelAwbNumber;
              naquelBookingRefNo = retryNaquelBookingRefNo;
              hasError = retryHasError;
              message = retryMessage;
              response = retryResponse;
              xmlPayload = retryXmlPayload;
              retrySuccess = true;
              break; // Exit retry loop successfully
            }
            
          } catch (retryError) {
            console.error(`❌ Retry attempt ${retryAttempt} failed:`, retryError.message);
            
            // Add safety check to prevent infinite loops in case of system issues
            if (retryAttempt >= 50) {
              return res.status(500).json({
                success: false,
                message: `System error: Failed after ${retryAttempt} retry attempts. Please check waybill availability or system status.`,
                error: 'WAYBILL_RETRY_SYSTEM_ERROR',
                details: retryError.message,
                totalAttempts: retryAttempt,
                timestamp: new Date().toISOString()
              });
            }
            
            // Continue retrying - don't break the loop for system errors
            console.log(`🔄 System error on attempt ${retryAttempt}, continuing with next attempt...`);
          }
        }
        
        // If we reach here and retrySuccess is false, it means we hit the safety limit
        if (!retrySuccess) {
          return res.status(400).json({
            success: false,
            message: `Safety limit reached: Multiple consecutive waybills already exist in Naquel system.`,
            error: 'WAYBILL_CONFLICT_SAFETY_LIMIT',
            data: {
              hasError: true,
              cityCodeUsed: cityCode,
              totalAttempts: retryAttempt,
              safetyLimit: 50
            },
            timestamp: new Date().toISOString()
          });
        }
        
      } else if (message && message.toLowerCase().includes('an error happen when saving the waybill details code : 120')) {
        // Special case: skip this waybill, do not mark as used or release, just retry
        console.log(`⏭  Skipping waybill ${allocatedWaybill.awb} due to Naquel error code 120, will try next waybill...`);
        
        // For custom waybill, don't retry - just return error
        if (req.body._useCustomWaybill) {
          return res.status(400).json({
            success: false,
            message: `Custom waybill ${allocatedWaybill.awb} failed with error code 120`,
            error: 'CUSTOM_WAYBILL_ERROR_120',
            data: {
              hasError: true,
              customWaybill: allocatedWaybill.awb,
              message: message
            },
            timestamp: new Date().toISOString()
          });
        }
        
        // Retry with new waybills until we find one that works (only for allocated waybills)
        let retryAttempt = 0;
        let retrySuccess = false;
        
        while (!retrySuccess) {
          retryAttempt++;
          console.log(` Retry attempt ${retryAttempt} - Getting new waybill for error 120...`);
          
          try {
            // Add a 0.5 second delay before each retry attempt
            await new Promise(resolve => setTimeout(resolve, 500));
            // Get a new waybill
            const newAllocation = await waybillManager.getNextAvailableWaybill('NAQUEL', 'PRIME');
            allocatedWaybill = newAllocation; // Update for final response
            shipmentData.waybillNo = newAllocation.awb;
            console.log(` New waybill allocated: ${newAllocation.awb} (retry ${retryAttempt})`);
            
            // Create new XML payload with new waybill
            const retryXmlPayload = mapJsonToXml(shipmentData, cityCode, loadTypeID);
            
            // Headers for SOAP request
            const headers = {
              'Content-Type': 'text/xml; charset=utf-8',
              'SOAPAction': 'http://tempuri.org/UpdateWaybill'
            };

            // Make retry API call to Naquel
            console.log(`📡 Sending retry request to Naquel API (attempt ${retryAttempt})...`);
            const retryResponse = await axios.post(process.env.NAQUEL_API, retryXmlPayload, { headers });
            
            // Parse retry response
            const retryParser = new xml2js.Parser({ explicitArray: false });
            const retryParsedResponse = await retryParser.parseStringPromise(retryResponse.data);
            
            // Extract retry response data
            const retryResult = retryParsedResponse['soap:Envelope']['soap:Body']['UpdateWaybillResponse']['UpdateWaybillResult'];
            const retryNaquelAwbNumber = retryResult.WaybillNo || null;
            const retryNaquelBookingRefNo = retryResult.BookingRefNo || null;
            const retryHasError = retryResult.HasError === 'true';
            const retryMessage = retryResult.Message || '';
            
            console.log(` Retry API Response - Error: ${retryHasError}, Message: ${retryMessage}`);
            
            if (retryHasError && retryMessage && retryMessage.toLowerCase().includes('waybill already exists')) {
              // This waybill also already exists, mark it and try again
              console.log(` Retry waybill ${newAllocation.awb} also exists, marking as used...`);
              try {
                await waybillManager.markWaybillAsUsed(newAllocation.awb, 'NAQUEL');
              } catch (markRetryError) {
                console.error('Failed to mark retry waybill as used:', markRetryError.message);
              }
              continue; // Try next waybill
            } else if (retryHasError && retryMessage && retryMessage.toLowerCase().includes('an error happen when saving the waybill details code : 120')) {
              // Special case: skip this waybill, do not mark as used or release, just continue
              console.log(` Skipping waybill ${newAllocation.awb} due to Naquel error code 120, will try next waybill...`);
              continue;
            } else if (retryHasError) {
              // Different error, release waybill and exit retry loop
              try {
                await waybillManager.releaseWaybill(newAllocation.awb, 'NAQUEL');
                console.log(` Released retry waybill ${newAllocation.awb} due to API error`);
              } catch (releaseError) {
                console.error('Failed to release retry waybill:', releaseError.message);
              }
              break; // Exit retry loop with error
            } else {
              // Success! Update variables for final processing
              console.log(` Retry successful with waybill ${newAllocation.awb}`);
              naquelAwbNumber = retryNaquelAwbNumber;
              naquelBookingRefNo = retryNaquelBookingRefNo;
              hasError = retryHasError;
              message = retryMessage;
              response = retryResponse;
              xmlPayload = retryXmlPayload;
              retrySuccess = true;
              break; // Exit retry loop successfully
            }
            
          } catch (retryError) {
            console.error(` Retry attempt ${retryAttempt} failed:`, retryError.message);
            
            // Add safety check to prevent infinite loops in case of system issues
            if (retryAttempt >= 50) {
              return res.status(500).json({
                success: false,
                message: `System error: Failed after ${retryAttempt} retry attempts. Please check waybill availability or system status.`,
                error: 'WAYBILL_RETRY_SYSTEM_ERROR',
                details: retryError.message,
                totalAttempts: retryAttempt,
                timestamp: new Date().toISOString()
              });
            }
            
            // Continue retrying - don't break the loop for system errors
            console.log(` System error on attempt ${retryAttempt}, continuing with next attempt...`);
          }
        }
        
        // If we reach here and retrySuccess is false, it means we hit the safety limit
        if (!retrySuccess) {
          return res.status(400).json({
            success: false,
            message: `Safety limit reached: Multiple consecutive waybills failed with error code 120.`,
            error: 'WAYBILL_ERROR_120_SAFETY_LIMIT',
            data: {
              hasError: true,
              cityCodeUsed: cityCode,
              totalAttempts: retryAttempt,
              safetyLimit: 50
            },
            timestamp: new Date().toISOString()
          });
        }
        
      } else {
        // Different type of error, release waybill and return error
        if (allocatedWaybill && allocatedWaybill.awb) {
          try {
            await waybillManager.releaseWaybill(allocatedWaybill.awb, 'NAQUEL');
            console.log(`Released waybill ${allocatedWaybill.awb} due to API error`);
          } catch (releaseError) {
            console.error('Failed to release waybill after API error:', releaseError.message);
          }
        }
      }
      
      const errorResponse = {
        success: false,
        message: message,
        error: 'NAQUEL_API_ERROR',
        data: {
          hasError: true,
          cityCodeUsed: cityCode,
          releasedWaybill: allocatedWaybill ? allocatedWaybill.awb : null
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
        databaseId: insertResult.insertId,
        allocatedWaybill: {
          awb: allocatedWaybill.awb,
          id: allocatedWaybill.id,
          vendor: allocatedWaybill.vendor,
          series: allocatedWaybill.series,
          isCustomWaybill: req.body._useCustomWaybill || false
        },
        customerShipment: customerShipment ? {
          id: customerShipment.shipmentId,
          awb: customerShipment.awbNumber,
          orderId: customerShipment.orderId,
          customerId: customerShipment.customerId
        } : null,
        currencyConversion: shipmentData.convertedProductValue ? {
          originalAmount: shipmentData.originalProductValue,
          originalCurrency: shipmentData.originalCurrency,
          convertedAmount: shipmentData.convertedProductValue,
          finalCurrency: shipmentData.finalCurrency
        } : null,
        unitValueConversion: shipmentData.convertedUnitValue ? {
          originalUnitValue: shipmentData.originalUnitValue,
          originalCurrency: shipmentData.originalCurrency,
          convertedUnitValue: shipmentData.convertedUnitValue,
          finalCurrency: shipmentData.finalCurrency
        } : null
      },
      timestamp: new Date().toISOString()
    };
    
    // Log the final response
    console.log('=== Final Success Response ===');
    console.log(JSON.stringify(finalResponse, null, 2));
    
    res.json(finalResponse);

  } catch (error) {
    console.error('Error in updateWayBill:', error.message);
    
    // Release the allocated waybill number back to the pool since operation failed
    // Only release if it was allocated from the pool (not custom waybill)
    if (allocatedWaybill && allocatedWaybill.awb && !req.body._useCustomWaybill) {
      try {
        await waybillManager.releaseWaybill(allocatedWaybill.awb, 'NAQUEL');
        console.log(`Released waybill ${allocatedWaybill.awb} due to system error`);
      } catch (releaseError) {
        console.error('Failed to release waybill after system error:', releaseError.message);
      }
    }
    
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
          (req.body && req.body.awb) || null,
          JSON.stringify(req.body || {}),
          `ERROR: ${error.message}`
        ]);
      } catch (dbError) {
        console.error('Failed to store error in database:', dbError.message);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update waybill',
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
const mapJsonToXml = (data, cityCode, loadTypeID) => {
  const xmlPayload = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <UpdateWaybill xmlns="http://tempuri.org/">
      <ManifestShipmentDetails>
        <ClientInfo>
          <ClientID>${process.env.NAQUEL_CLIENTID}</ClientID>
          <Password>${process.env.NAQUEL_PASSWORD}</Password>
          <Version>${process.env.NAQUEL_VERSION}</Version>
          <ClientAddress>
            <PhoneNumber>${data.sellerMobile}</PhoneNumber>
            <FirstAddress> </FirstAddress>
            <CountryCode>AE</CountryCode>
            <CityCode>DXB</CityCode>
          </ClientAddress>
          <ClientContact>
            <Name>${data.sellerFirstName} ${data.sellerLastName}</Name>
            <Email>${data.sellerEmail}</Email>
            <PhoneNumber>${data.sellerMobile}</PhoneNumber>
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
            <UnitCost>${data.convertedUnitValue || (data.Pcs == 1 ? data.convertedProductValue : (data.Pcs > 1 ? (data.convertedProductValue / data.Pcs).toFixed(2) : '')) || ''}</UnitCost>
            <CustomsCommodityCode>${data.Items && data.Items[0] ? data.Items[0].HSCode : ''}</CustomsCommodityCode>
            <Currency>${data.finalCurrency || 'USD'}</Currency>
          </CommercialInvoiceDetailList>
          <InvoiceNo>${data.GSTInvoiceNumber}</InvoiceNo>
        </_CommercialInvoice>
        <BillingType>1</BillingType> 
        <PicesCount>1</PicesCount>
        <Weight>${data.weight}</Weight>
        <CODCharge>0</CODCharge>
        <LoadTypeID>${loadTypeID}</LoadTypeID>
        <RefNo>${data.export_reference}</RefNo>
        <DeclareValue>${data.convertedProductValue}</DeclareValue>
        <GoodDesc>${data.productDescription}</GoodDesc>
        <InsuredValue>0</InsuredValue>
        <GeneratePiecesBarCodes>true</GeneratePiecesBarCodes>
        <CreateBooking>true</CreateBooking>
       <PickUpPoint> </PickUpPoint>
        <CustomDutyAmount>0</CustomDutyAmount>
        <GoodsVATAmount>0</GoodsVATAmount>
        <IsCustomDutyPayByConsignee>false</IsCustomDutyPayByConsignee>
         <CurrenyID>4</CurrenyID>
        <IsRTO>false</IsRTO>
      </ManifestShipmentDetails>
      <WaybillNo>${data.waybillNo}</WaybillNo>
    </UpdateWaybill>
  </soap:Body>
</soap:Envelope>`;

  return xmlPayload;
};



module.exports = {
  updateWayBill,
  generateExportReference,
  getShipmentDataByAwb
};
