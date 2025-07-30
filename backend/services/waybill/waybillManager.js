const pool = require('../../config/db');

/**
 * Waybill Manager Service
 * Handles allocation and management of waybill numbers from the database
 */
class WaybillManager {
  
  /**
   * Get the next available waybill number for a specific vendor
   * @param {string} vendor - Vendor name (e.g., 'NAQUEL')
   * @param {string} series - Series type (e.g., 'PRIME') 
   * @returns {Promise<Object>} - Object containing awb number and database ID
   */
  async getNextAvailableWaybill(vendor = 'NAQUEL', series = 'PRIME') {
    let connection;
    
    try {
      connection = await pool.getConnection();
      
      // Start a transaction to ensure atomic operation
      await connection.beginTransaction();
      
      // Find the next available waybill number
      const selectQuery = `
        SELECT id, awb 
        FROM last_mile_awb_numbers 
        WHERE vendor = ? 
        AND series = ? 
        AND is_used = 0 
        AND is_test = 0
        ORDER BY awb ASC 
        LIMIT 1 
        FOR UPDATE
      `;
      
      const [rows] = await connection.execute(selectQuery, [vendor, series]);
      
      if (rows.length === 0) {
        await connection.rollback();
        
        // Check if all waybills are used up
        const totalCheckQuery = `
          SELECT 
            COUNT(*) as total_waybills,
            SUM(CASE WHEN is_used = 1 THEN 1 ELSE 0 END) as used_waybills
          FROM last_mile_awb_numbers 
          WHERE vendor = ? 
          AND series = ? 
          AND is_test = 0
        `;
        
        const [totalRows] = await connection.execute(totalCheckQuery, [vendor, series]);
        const { total_waybills, used_waybills } = totalRows[0];
        
        if (total_waybills > 0 && used_waybills === total_waybills) {
          // All waybills are used up
          throw new Error(`WAYBILL_LIMIT_REACHED: All ${total_waybills} waybills are created for vendor: ${vendor}, series: ${series}`);
        } else {
          // No waybills exist in database at all
          throw new Error(`No waybill numbers configured for vendor: ${vendor}, series: ${series}. Please add waybill numbers to the database.`);
        }
      }
      
      const waybillRecord = rows[0];
      
      // Mark the waybill as used
      const updateQuery = `
        UPDATE last_mile_awb_numbers 
        SET is_used = 1, 
            used_at = NOW(), 
            modified_at = NOW() 
        WHERE id = ?
      `;
      
      await connection.execute(updateQuery, [waybillRecord.id]);
      
      // Commit the transaction
      await connection.commit();
      
      console.log(`✅ Allocated waybill number: ${waybillRecord.awb} (ID: ${waybillRecord.id})`);
      
      return {
        success: true,
        awb: waybillRecord.awb,
        id: waybillRecord.id,
        vendor: vendor,
        series: series
      };
      
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }
      
      console.error('❌ Error allocating waybill number:', error.message);
      throw new Error(`Failed to allocate waybill number: ${error.message}`);
      
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
  
  /**
   * Get statistics about waybill usage
   * @param {string} vendor - Vendor name
   * @param {string} series - Series type
   * @returns {Promise<Object>} - Usage statistics
   */
  async getWaybillStats(vendor = 'NAQUEL', series = 'PRIME') {
    let connection;
    
    try {
      connection = await pool.getConnection();
      
      const statsQuery = `
        SELECT 
          COUNT(*) as total_waybills,
          SUM(CASE WHEN is_used = 1 THEN 1 ELSE 0 END) as used_waybills,
          SUM(CASE WHEN is_used = 0 THEN 1 ELSE 0 END) as available_waybills,
          MIN(CASE WHEN is_used = 0 THEN awb END) as next_available_awb,
          MAX(CASE WHEN is_used = 1 THEN awb END) as last_used_awb
        FROM last_mile_awb_numbers 
        WHERE vendor = ? 
        AND series = ? 
        AND is_test = 0
      `;
      
      const [rows] = await connection.execute(statsQuery, [vendor, series]);
      
      return {
        success: true,
        vendor: vendor,
        series: series,
        stats: rows[0]
      };
      
    } catch (error) {
      console.error('❌ Error fetching waybill stats:', error.message);
      throw new Error(`Failed to fetch waybill stats: ${error.message}`);
      
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
  
  /**
   * Mark a waybill as used (for cases where Naquel API says it already exists)
   * @param {string} awb - Waybill number to mark as used
   * @param {string} vendor - Vendor name
   * @returns {Promise<Object>} - Operation result
   */
  async markWaybillAsUsed(awb, vendor = 'NAQUEL') {
    let connection;
    
    try {
      connection = await pool.getConnection();
      
      const markUsedQuery = `
        UPDATE last_mile_awb_numbers 
        SET is_used = 1, 
            used_at = NOW(), 
            modified_at = NOW() 
        WHERE awb = ? 
        AND vendor = ?
        AND is_used = 0
      `;
      
      const [result] = await connection.execute(markUsedQuery, [awb, vendor]);
      
      if (result.affectedRows === 0) {
        console.log(`⚠️  Waybill ${awb} was already marked as used or not found`);
        return {
          success: false,
          awb: awb,
          message: 'Waybill already used or not found'
        };
      }
      
      console.log(`🔒 Marked waybill number as used: ${awb} (Naquel API conflict detected)`);
      
      return {
        success: true,
        awb: awb,
        message: 'Waybill marked as used successfully'
      };
      
    } catch (error) {
      console.error('❌ Error marking waybill as used:', error.message);
      throw new Error(`Failed to mark waybill as used: ${error.message}`);
      
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }


  
  /**
   * Check if a specific waybill number is available
   * @param {string} awb - Waybill number to check
   * @param {string} vendor - Vendor name
   * @returns {Promise<Object>} - Availability status
   */
  async checkWaybillAvailability(awb, vendor = 'NAQUEL') {
    let connection;
    
    try {
      connection = await pool.getConnection();
      
      const checkQuery = `
        SELECT id, awb, is_used, used_at 
        FROM last_mile_awb_numbers 
        WHERE awb = ? 
        AND vendor = ?
      `;
      
      const [rows] = await connection.execute(checkQuery, [awb, vendor]);
      
      if (rows.length === 0) {
        return {
          success: false,
          awb: awb,
          exists: false,
          available: false,
          message: 'Waybill number not found in database'
        };
      }
      
      const waybill = rows[0];
      
      return {
        success: true,
        awb: awb,
        exists: true,
        available: waybill.is_used === 0,
        used_at: waybill.used_at,
        message: waybill.is_used === 0 ? 'Available' : 'Already used'
      };
      
    } catch (error) {
      console.error('❌ Error checking waybill availability:', error.message);
      throw new Error(`Failed to check waybill availability: ${error.message}`);
      
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
}

// Create a singleton instance
const waybillManager = new WaybillManager();

module.exports = waybillManager; 