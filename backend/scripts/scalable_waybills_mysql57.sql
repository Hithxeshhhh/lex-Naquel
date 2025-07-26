-- Scalable Waybill Number Generator for MySQL 5.7
-- Can generate LAKHS of waybill numbers efficiently
-- Example: Generate 1 lakh numbers from 300000000 to 300099999

-- For LARGE SCALE: Uncomment and modify the range below
-- This example generates 1 lakh (100,000) numbers: 300000000 to 300099999

/*
INSERT INTO last_mile_awb_numbers (
  awb,
  vendor,
  series,
  is_used,
  is_test,
  created_by,
  modified_by,
  created_at,
  modified_at,
  type
)
SELECT 
  CONCAT('3000', 
    LPAD(
      (ten_thousands.digit * 10000 + thousands.digit * 1000 + hundreds.digit * 100 + tens.digit * 10 + units.digit), 
      5, 
      '0'
    )
  ) as awb,
  'NAQUEL' as vendor,
  'PRIME' as series,
  0 as is_used,
  0 as is_test,
  7401 as created_by,
  7401 as modified_by,
  NOW() as created_at,
  NOW() as modified_at,
  0 as type
FROM 
  -- Ten thousands place (0-9) - controls 10 lakh range
  (SELECT 0 as digit UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 
   UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) ten_thousands
CROSS JOIN 
  -- Thousands place (0-9) 
  (SELECT 0 as digit UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 
   UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) thousands
CROSS JOIN 
  -- Hundreds place (0-9)
  (SELECT 0 as digit UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 
   UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) hundreds
CROSS JOIN 
  -- Tens place (0-9)
  (SELECT 0 as digit UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 
   UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) tens
CROSS JOIN 
  -- Units place (0-9)
  (SELECT 0 as digit UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 
   UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) units
WHERE 
  -- Filter for specific range (modify as needed)
  CONCAT('3000', 
    LPAD(
      (ten_thousands.digit * 10000 + thousands.digit * 1000 + hundreds.digit * 100 + tens.digit * 10 + units.digit), 
      5, 
      '0'
    )
  ) BETWEEN '300000000' AND '300099999'  -- 1 lakh numbers
ORDER BY awb;
*/

-- SMALLER BATCH VERSION (recommended for phpMyAdmin):
-- Generate in batches of 10,000 at a time to avoid timeouts

-- BATCH 1: 300006000 to 300006999 (1000 numbers)
INSERT INTO last_mile_awb_numbers (
  awb,
  vendor,
  series,
  is_used,
  is_test,
  created_by,
  modified_by,
  created_at,
  modified_at,
  type
)
SELECT 
  CONCAT('30000', 
    LPAD(
      (h.digit * 1000 + t.digit * 100 + d.digit * 10 + u.digit), 
      4, 
      '0'
    )
  ) as awb,
  'NAQUEL' as vendor,
  'PRIME' as series,
  0 as is_used,
  0 as is_test,
  7401 as created_by,
  7401 as modified_by,
  NOW() as created_at,
  NOW() as modified_at,
  0 as type
FROM 
  (SELECT 6 as digit) h  -- Fixed at 6 for 300006xxx
CROSS JOIN 
  (SELECT 0 as digit UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 
   UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) t
CROSS JOIN 
  (SELECT 0 as digit UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 
   UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) d
CROSS JOIN 
  (SELECT 0 as digit UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 
   UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) u
ORDER BY awb;

-- Verification queries
SELECT 
  COUNT(*) as total_inserted,
  MIN(awb) as first_awb,
  MAX(awb) as last_awb
FROM last_mile_awb_numbers 
WHERE vendor = 'NAQUEL' 
AND awb BETWEEN '300006000' AND '300006999';

-- Template for generating more batches:
/*
-- BATCH 2: 300007000 to 300007999 (next 1000 numbers)
-- Just change the h.digit value from 6 to 7

-- BATCH 3: 300008000 to 300008999 (next 1000 numbers)  
-- Just change the h.digit value from 6 to 8

-- And so on...
*/

-- PERFORMANCE TIPS for LAKHS of numbers:
-- 1. Run in batches of 10,000 numbers max per query
-- 2. Use phpMyAdmin's "Simulate query" first to check syntax
-- 3. Consider running during off-peak hours
-- 4. Monitor your database server resources
-- 5. Add an index on (vendor, awb) if not already present:
--    CREATE INDEX idx_vendor_awb ON last_mile_awb_numbers(vendor, awb); 