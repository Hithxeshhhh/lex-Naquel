-- Insert Naquel waybill numbers from 300006000 to 300006999
-- MySQL 5.7 Compatible Version (no recursive CTE needed)
-- This approach can scale to lakhs of numbers by adjusting the digit tables

-- Create a temporary numbers table using CROSS JOIN approach
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
  (SELECT 6 as digit) h  -- thousands (fixed at 6 for 300006xxx)
CROSS JOIN 
  (SELECT 0 as digit UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 
   UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) t  -- hundreds
CROSS JOIN 
  (SELECT 0 as digit UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 
   UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) d  -- tens
CROSS JOIN 
  (SELECT 0 as digit UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 
   UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) u  -- units
ORDER BY awb;

-- Verify the insertion
SELECT 
  COUNT(*) as total_inserted,
  MIN(awb) as first_awb,
  MAX(awb) as last_awb,
  COUNT(DISTINCT awb) as unique_count
FROM last_mile_awb_numbers 
WHERE vendor = 'NAQUEL' 
AND awb BETWEEN '300006000' AND '300006999';

-- Check for any missing numbers in the sequence
SELECT 
  CONCAT('Missing numbers count: ', 
    1000 - COUNT(*)
  ) as missing_check
FROM last_mile_awb_numbers 
WHERE vendor = 'NAQUEL' 
AND awb BETWEEN '300006000' AND '300006999';

-- Show sample of inserted records
SELECT awb, vendor, series, is_used, created_at
FROM last_mile_awb_numbers 
WHERE vendor = 'NAQUEL' 
AND awb BETWEEN '300006000' AND '300006999'
ORDER BY awb
LIMIT 10; 