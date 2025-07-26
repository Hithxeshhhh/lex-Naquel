const waybillManager = require('./waybillManager');

/**
 * Test script for Waybill Manager Service
 * Run this to verify that waybill allocation and management works correctly
 */
async function testWaybillManager() {
  console.log('🧪 Testing Waybill Manager Service...\n');
  
  try {
    
    // Test 1: Get waybill statistics
    console.log('📊 Test 1: Getting waybill statistics...');
    const stats = await waybillManager.getWaybillStats('NAQUEL', 'PRIME');
    console.log('Stats:', JSON.stringify(stats, null, 2));
    console.log('✅ Test 1 passed\n');
    
    // Test 2: Allocate a waybill number
    console.log('📝 Test 2: Allocating waybill number...');
    const allocated = await waybillManager.getNextAvailableWaybill('NAQUEL', 'PRIME');
    console.log('Allocated:', JSON.stringify(allocated, null, 2));
    console.log('✅ Test 2 passed\n');
    
    // Test 3: Check if the allocated waybill is now used
    console.log('🔍 Test 3: Checking allocated waybill status...');
    const checkResult = await waybillManager.checkWaybillAvailability(allocated.awb, 'NAQUEL');
    console.log('Check result:', JSON.stringify(checkResult, null, 2));
    
    if (checkResult.available === false) {
      console.log('✅ Test 3 passed - Waybill is correctly marked as used\n');
    } else {
      console.log('❌ Test 3 failed - Waybill should be marked as used\n');
      return;
    }
    
    // Test 4: Release the waybill back to the pool
    console.log('🔄 Test 4: Releasing waybill back to pool...');
    const released = await waybillManager.releaseWaybill(allocated.awb, 'NAQUEL');
    console.log('Released:', JSON.stringify(released, null, 2));
    console.log('✅ Test 4 passed\n');
    
    // Test 5: Check if the waybill is now available again
    console.log('🔍 Test 5: Checking released waybill status...');
    const checkReleased = await waybillManager.checkWaybillAvailability(allocated.awb, 'NAQUEL');
    console.log('Check result:', JSON.stringify(checkReleased, null, 2));
    
    if (checkReleased.available === true) {
      console.log('✅ Test 5 passed - Waybill is correctly marked as available\n');
    } else {
      console.log('❌ Test 5 failed - Waybill should be marked as available\n');
      return;
    }
    
    // Test 6: Get updated statistics
    console.log('📊 Test 6: Getting updated waybill statistics...');
    const updatedStats = await waybillManager.getWaybillStats('NAQUEL', 'PRIME');
    console.log('Updated stats:', JSON.stringify(updatedStats, null, 2));
    console.log('✅ Test 6 passed\n');
    
    // Test 7: Allocate multiple waybills to test sequential allocation
    console.log('🔢 Test 7: Allocating multiple waybills...');
    const allocatedWaybills = [];
    
    for (let i = 0; i < 3; i++) {
      const waybill = await waybillManager.getNextAvailableWaybill('NAQUEL', 'PRIME');
      allocatedWaybills.push(waybill);
      console.log(`Allocated ${i + 1}: ${waybill.awb}`);
    }
    
    console.log('✅ Test 7 passed - Multiple waybills allocated\n');
    
    // Test 8: Release all allocated waybills
    console.log('🔄 Test 8: Releasing all allocated waybills...');
    for (const waybill of allocatedWaybills) {
      await waybillManager.releaseWaybill(waybill.awb, 'NAQUEL');
      console.log(`Released: ${waybill.awb}`);
    }
    console.log('✅ Test 8 passed - All waybills released\n');
    
    // Test 9: Test markWaybillAsUsed function (for Naquel conflict handling)
    console.log('🔒 Test 9: Testing markWaybillAsUsed function...');
    const testWaybill = await waybillManager.getNextAvailableWaybill('NAQUEL', 'PRIME');
    console.log(`Allocated test waybill: ${testWaybill.awb}`);
    
    // Release it first to make it available
    await waybillManager.releaseWaybill(testWaybill.awb, 'NAQUEL');
    console.log(`Released test waybill: ${testWaybill.awb}`);
    
    // Now mark it as used (simulating Naquel conflict scenario)
    const markResult = await waybillManager.markWaybillAsUsed(testWaybill.awb, 'NAQUEL');
    console.log('Mark result:', JSON.stringify(markResult, null, 2));
    
    // Verify it's marked as used
    const checkMarked = await waybillManager.checkWaybillAvailability(testWaybill.awb, 'NAQUEL');
    if (checkMarked.available === false && checkMarked.message === 'Already used') {
      console.log('✅ Test 9 passed - Waybill correctly marked as used\n');
    } else {
      console.log('❌ Test 9 failed - Waybill not properly marked as used\n');
      return;
    }
    
    console.log('🎉 ALL TESTS PASSED! Waybill Manager is working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Error details:', error);
  }
}

// Performance test
async function performanceTest() {
  console.log('\n⚡ Performance Test: Allocating 10 waybills...');
  const startTime = Date.now();
  
  try {
    const allocatedWaybills = [];
    
    for (let i = 0; i < 10; i++) {
      const waybill = await waybillManager.getNextAvailableWaybill('NAQUEL', 'PRIME');
      allocatedWaybills.push(waybill);
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`✅ Allocated 10 waybills in ${duration}ms (${duration/10}ms per waybill)`);
    
    // Release all allocated waybills
    for (const waybill of allocatedWaybills) {
      await waybillManager.releaseWaybill(waybill.awb, 'NAQUEL');
    }
    
    console.log('✅ All waybills released');
    
  } catch (error) {
    console.error('❌ Performance test failed:', error.message);
  }
}

// Run tests
async function runAllTests() {
  await testWaybillManager();
  await performanceTest();
  process.exit(0);
}

// Export for external testing
if (require.main === module) {
  runAllTests();
}

module.exports = {
  testWaybillManager,
  performanceTest
}; 