const pool = require('../config/db');

// Function to log errors to Naquel_error_logs table
const logError = async (errorData) => {
  let connection;
  
  try {
    connection = await pool.getConnection();
    
    const insertQuery = `
      INSERT INTO Naquel_error_logs 
      (controller_name, error_type, error_code, error_message, request_data, response_data, 
       waybill_number, export_reference, city_code, http_status, api_status, has_error, stack_trace) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const [result] = await connection.execute(insertQuery, [
      errorData.controllerName || 'unknown',
      errorData.errorType || 'GENERAL_ERROR',
      errorData.errorCode || null,
      errorData.errorMessage || 'Unknown error occurred',
      errorData.requestData ? JSON.stringify(errorData.requestData) : null,
      errorData.responseData ? JSON.stringify(errorData.responseData) : null,
      errorData.waybillNumber || null,
      errorData.exportReference || null,
      errorData.cityCode || null,
      errorData.httpStatus || null,
      errorData.apiStatus || null,
      errorData.hasError ? 1 : 0,
      errorData.stackTrace || null
    ]);
    
    console.log(`✅ Error logged to database with ID: ${result.insertId}`);
    return result.insertId;
    
  } catch (dbError) {
    console.error('❌ Failed to log error to database:', dbError.message);
    // Don't throw error to avoid cascading failures
    return null;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

module.exports = {
  logError
}; 