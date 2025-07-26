const pool = require('./config/db');

// Function to lookup city code (updated to match controllers)
const lookupCityCode = async (consigneeCity, consigneeState, consigneeCountryCode) => {
  let connection;
  
  try {
    connection = await pool.getConnection();
    console.log(`\n🔍 Looking up city code for: ${consigneeCity}, ${consigneeState}, ${consigneeCountryCode}`);
    
    // First try: Direct search by city name and country
    let query = `
      SELECT CityCode, CityName, CountryCode 
      FROM Naquel_Pincodes 
      WHERE CityName = ? AND CountryCode = ?
      LIMIT 1
    `;
    
    let [rows] = await connection.execute(query, [consigneeCity, consigneeCountryCode]);
    console.log(`   Step 1 - Direct city search: ${rows.length} matches`);
    
    if (rows.length > 0) {
      console.log(`   ✅ Found direct match: ${rows[0].CityName} -> ${rows[0].CityCode}`);
      return { cityCode: rows[0].CityCode, matchType: 'Direct city match', match: rows[0] };
    }
    
    // Second try: Search by state/city combination
    if (consigneeState && consigneeState !== consigneeCity) {
      [rows] = await connection.execute(query, [consigneeState, consigneeCountryCode]);
      console.log(`   Step 2 - State search: ${rows.length} matches`);
      
      if (rows.length > 0) {
        console.log(`   ✅ Found state match: ${rows[0].CityName} -> ${rows[0].CityCode}`);
        return { cityCode: rows[0].CityCode, matchType: 'State match', match: rows[0] };
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
    console.log(`   Step 3 - Fuzzy search: ${rows.length} matches`);
    
    if (rows.length > 0) {
      console.log(`   ✅ Found fuzzy match: ${rows[0].CityName} -> ${rows[0].CityCode}`);
      rows.forEach((row, index) => {
        console.log(`      ${index + 1}. ${row.CityName} (${row.CityCode})`);
      });
      return { cityCode: rows[0].CityCode, matchType: 'Fuzzy match', match: rows[0], allMatches: rows };
    }
    
    // Fourth try: Any city for the country
    query = `
      SELECT CityCode, CityName, CountryCode 
      FROM Naquel_Pincodes 
      WHERE CountryCode = ?
      ORDER BY CityCode
      LIMIT 5
    `;
    
    [rows] = await connection.execute(query, [consigneeCountryCode]);
    console.log(`   Step 4 - Country cities: ${rows.length} available cities`);
    
    if (rows.length > 0) {
      console.log(`   ⚠️  Using any available city: ${rows[0].CityName} -> ${rows[0].CityCode}`);
      rows.forEach((row, index) => {
        console.log(`      ${index + 1}. ${row.CityName} (${row.CityCode})`);
      });
      return { cityCode: rows[0].CityCode, matchType: 'Country fallback', match: rows[0], availableCities: rows };
    }
    
    // No match found
    console.log(`   ❌ No city code found in database`);
    return { cityCode: null, matchType: 'No match found' };
    
  } catch (error) {
    console.error('❌ Error looking up city code:', error.message);
    return { cityCode: null, matchType: 'Error', error: error.message };
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// Test cases
const testCases = [
  // From sample.json
  { city: 'Abu Dhabi', state: 'Abu Dhabi', country: 'AE' },
  
  // Other test cases
  { city: 'Dubai', state: 'Dubai', country: 'AE' },
  { city: 'Riyadh', state: 'Riyadh', country: 'KSA' },
  { city: 'Kuwait City', state: 'Kuwait', country: 'KW' },
  { city: 'Manama', state: 'Manama', country: 'BH' },
  { city: 'Amman', state: 'Amman', country: 'JO' },
  
  // Test cases that might not match exactly
  { city: 'Sharjah', state: 'Sharjah', country: 'AE' },
  { city: 'Jeddah', state: 'Makkah', country: 'KSA' },
  { city: 'Dammam', state: 'Eastern Province', country: 'KSA' },
  
  // Test cases that should fail and use fallbacks
  { city: 'Unknown City', state: 'Unknown State', country: 'AE' },
  { city: 'Test City', state: 'Test State', country: 'XX' },
];

// Run tests
async function runTests() {
  console.log('🧪 Testing Naquel City Code Lookup System');
  console.log('=' * 50);
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n📋 Test ${i + 1}/${testCases.length}`);
    
    const result = await lookupCityCode(testCase.city, testCase.state, testCase.country);
    
    console.log(`   Result: ${result.cityCode} (${result.matchType})`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }
  
  console.log('\n✅ All tests completed!');
  process.exit(0);
}

// Run the tests
runTests().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
}); 