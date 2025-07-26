# Migration Guide: From sample.json to customer_shippments Database

This document explains the complete transformation of the waybill processing system from using `sample.json` files to database-driven approach using the `customer_shippments` table.

## 🔄 **What Changed?**

### **Before: Manual JSON Input**
```json
// Previously required in request body
{
  "waybillNo": "300006103",
  "sellerID": "bxmontana",
  "sellerFirstName": "Deepak",
  "consigneeFirstName": "vijayakumaran",
  // ... all shipment details manually provided
}
```

### **After: Database-Driven AWB Lookup**
```json
// Now only requires AWB number
{
  "awb": "1000024460901"
}
```

## 📊 **Database Schema Used**

The system now uses the `customer_shippments` table:

```sql
customer_shippments (
  id,
  awb_number,           -- The AWB to lookup
  payload,              -- JSON containing all shipment details
  order_id,
  customer_id,
  created_at,
  updated_at,
  -- ... other fields
)
```

## 🔄 **New Workflow**

1. **Request Input**: `{"awb": "1000024460901"}`
2. **Database Lookup**: System finds shipment in `customer_shippments` table
3. **Payload Extraction**: JSON payload is parsed and used as shipment data
4. **Waybill Allocation**: System auto-allocates next available NAQUEL waybill
5. **API Processing**: Data sent to Naquel API with allocated waybill
6. **Response**: Returns success with waybill details

## 🎯 **New API Endpoints**

### **Production Endpoint**
```bash
POST /update-waybill
Body: {"awb": "1000024460901"}
```

### **Helper Endpoints**
```bash
# List available shipments for testing
GET /customer-shipments

# Check specific shipment data
GET /customer-shipment/1000024460901
```

## 📁 **File Changes**

### **Removed Files** ❌
- `backend/test/sample.json` - No longer needed
- `backend/scripts/insert_naquel_waybill_numbers.sql` - MySQL 8.0 version
- `backend/scripts/insert_waybill_numbers.js` - Node.js helper
- `backend/scripts/insert_naquel_waybill_numbers_legacy.sql` - Partial version
- `backend/scripts/bulk_insert_waybills.js` - Alternative approach

### **New Files** ✅
- `backend/services/waybill/waybillManager.js` - Waybill allocation service
- `backend/services/waybill/testWaybillManager.js` - Test suite
- `backend/services/waybill/README.md` - Documentation
- `backend/scripts/naquel_waybills_mysql57.sql` - Waybill number setup
- `backend/scripts/scalable_waybills_mysql57.sql` - Large scale setup

### **Updated Files** 🔄
- `backend/controller/updateWayBill.controller.js` - Major changes
- `backend/routes/naquel.js` - New routes and deprecated old ones

## 🚀 **Key Benefits**

### **1. Automated Waybill Management**
- ✅ No manual waybill number input
- ✅ Automatic allocation from database pool
- ✅ Prevention of duplicate waybill usage
- ✅ Error recovery (waybill release on failure)

### **2. Database-Driven Data**
- ✅ No need to maintain sample.json files
- ✅ Real customer shipment data
- ✅ Centralized data management
- ✅ Easy data updates and corrections

### **3. Improved Error Handling**
- ✅ Better validation and error messages
- ✅ Automatic waybill cleanup on failures
- ✅ Automatic conflict resolution with unlimited retries
- ✅ Detailed logging and tracking

### **4. Scalability**
- ✅ Handle thousands of waybill numbers
- ✅ Thread-safe operations
- ✅ Database transaction safety

### **5. Conflict Resolution**
- ✅ Automatic detection of "waybill already exists" errors
- ✅ Unlimited retry attempts until finding available waybill
- ✅ Database synchronization with Naquel's actual state
- ✅ Transparent operation - users don't see conflicts

## 🧪 **Testing the New System**

### **Step 1: Check Available Shipments**
```bash
curl -X GET http://localhost:3000/api/naquel/customer-shipments
```

### **Step 2: Check Specific Shipment**
```bash
curl -X GET http://localhost:3000/api/naquel/customer-shipment/1000024460901
```

### **Step 3: Process Shipment**
```bash
curl -X POST http://localhost:3000/api/naquel/update-waybill \
  -H "Content-Type: application/json" \
  -d '{"awb": "1000024460901"}'
```

### **Step 4: Verify Waybill Usage**
```sql
-- Check waybill allocation
SELECT * FROM last_mile_awb_numbers 
WHERE vendor = 'NAQUEL' AND is_used = 1 
ORDER BY used_at DESC LIMIT 5;

-- Check Naquel API responses
SELECT * FROM Naquel_awb 
ORDER BY created_at DESC LIMIT 5;
```

## 📊 **Response Format Changes**

### **New Success Response**
```json
{
  "success": true,
  "message": "Waybill updated successfully",
  "data": {
    "waybillNo": "NAQUEL123456",
    "bookingRefNo": "BK123456",
    "cityCodeUsed": "DXB",
    "allocatedWaybill": {
      "awb": "300006000",
      "id": 12345,
      "vendor": "NAQUEL",
      "series": "PRIME"
    },
    "customerShipment": {
      "id": 789,
      "awb": "1000024460901",
      "orderId": "ORD123",
      "customerId": 456
    },
    "currencyConversion": { ... },
    "labelAvailable": true
  }
}
```

### **Error Response Examples**
```json
// AWB not provided
{
  "success": false,
  "message": "AWB number is required",
  "error": "AWB_NUMBER_REQUIRED",
  "example": {"awb": "1000024460901"}
}

// Shipment not found
{
  "success": false,
  "message": "Shipment not found",
  "error": "SHIPMENT_NOT_FOUND",
  "awb": "1000024460901"
}

// No available waybills
{
  "success": false,
  "message": "No available waybill numbers",
  "error": "WAYBILL_ALLOCATION_FAILED"
}

// Safety limit reached (very rare - indicates major system issue)
{
  "success": false,
  "message": "Safety limit reached: Multiple consecutive waybills already exist in Naquel system.",
  "error": "WAYBILL_CONFLICT_SAFETY_LIMIT",
  "data": {
    "totalAttempts": 50,
    "safetyLimit": 50
  }
}
```

## 🔧 **Configuration Requirements**

### **Database Tables**
1. `customer_shippments` - Must contain payload data
2. `last_mile_awb_numbers` - Pre-populated with NAQUEL waybills
3. `Naquel_awb` - Stores API requests/responses

### **Environment Variables**
- All existing Naquel API environment variables still required
- Database connection settings

### **Waybill Setup**
Run once to populate waybill numbers:
```bash
# Import 1000 waybill numbers (300006000-300006999)
mysql -u username -p database < backend/scripts/naquel_waybills_mysql57.sql
```

## 🚨 **Breaking Changes**

### **API Contract Change**
- **Old**: Full shipment data in request body
- **New**: Only AWB number in request body

### **Response Changes**
- Added `allocatedWaybill` section
- Added `customerShipment` section
- Enhanced error messages with more context

### **Removed Endpoints**
- `/test-with-sample-json` - REMOVED (was deprecated)
- `/test-update-waybill` - REMOVED (was deprecated)
- `/test-update-waybill-by-awb` - REMOVED (redundant with `/update-waybill`)

## 📞 **Troubleshooting**

### **Common Issues**

1. **"Shipment not found"**
   - Check if AWB exists in `customer_shippments` table
   - Verify `payload` field is not NULL
   - Check payload contains valid JSON

2. **"No available waybill numbers"**
   - Run waybill setup SQL script
   - Check `last_mile_awb_numbers` table has `is_used=0` records
   - Verify vendor='NAQUEL' and series='PRIME'

3. **"Invalid JSON in payload"**
   - Check payload field in database contains valid JSON
   - Verify JSON structure matches expected format

4. **"Safety limit reached"** (very rare)
   - Indicates 50+ consecutive waybills already exist in Naquel
   - Check if waybill number range needs to be expanded
   - May indicate synchronization issue between systems

### **Debug Commands**
```sql
-- Check customer shipment
SELECT id, awb_number, order_id, 
       CASE WHEN payload IS NULL THEN 'NULL' ELSE 'Available' END as payload_status
FROM customer_shippments 
WHERE awb_number = '1000024460901';

-- Check available waybills
SELECT COUNT(*) as available_waybills 
FROM last_mile_awb_numbers 
WHERE vendor = 'NAQUEL' AND is_used = 0;

-- Check recent API calls
SELECT awb_number, Naquel_awb_number, created_at 
FROM Naquel_awb 
ORDER BY created_at DESC LIMIT 5;
```

## ✅ **Migration Checklist**

- [ ] Import waybill numbers using SQL script
- [ ] Verify `customer_shippments` table has payload data
- [ ] Test new endpoint with sample AWB
- [ ] Update frontend/client code to use new API format
- [ ] Remove references to old sample.json approach
- [ ] Update documentation and API references
- [ ] Train team on new workflow

## 🎉 **Summary**

The migration successfully:
- ✅ Eliminated manual JSON file management
- ✅ Implemented automatic waybill allocation
- ✅ Added database-driven shipment processing
- ✅ Improved error handling and recovery
- ✅ Enhanced scalability and thread safety
- ✅ Maintained backward compatibility where possible

The new system is more robust, scalable, and easier to maintain while providing better error handling and automatic resource management. 