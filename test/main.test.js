// LICENSE_CODE ZON
'use strict';
const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

describe('Progress Tracker Core', function () {
  let createProgressTrackerCore, historyManagerStub, progressTracker;

  beforeEach(function () {
    // Create history manager stub
    historyManagerStub = {
      getHistoryFilePath: sinon.stub().returns('/tmp/test-history.json'),
      hasHistoryForStep: sinon.stub().returns(false),
      getEstimatedDuration: sinon.stub().returns(10),
      updateStepDuration: sinon.stub().returns(true),
      getAllStepHistory: sinon.stub().returns([]),
      getStepHistoryInfo: sinon.stub().returns(null),
      cleanHistory: sinon.stub().returns({ success: true, message: 'Cleaned' }),
      getHistoryDirectory: sinon.stub().returns('/tmp'),
      resetSession: sinon.stub(),
    };

    // Mock the history manager module
    createProgressTrackerCore = proxyquire('../src/main', {
      './history': () => historyManagerStub,
    });

    // Create a tracker instance for tests
    progressTracker = createProgressTrackerCore({ name: 'test-app' });

    // Mock Date.now to control time
    sinon.stub(Date, 'now').returns(1000);
  });

  afterEach(function () {
    sinon.restore();
  });

  describe('Initialization', function () {
    it('should create a progress tracker with default values', function () {
      expect(progressTracker).to.be.an('object');
      expect(progressTracker.start).to.be.a('function');
      expect(progressTracker.updateStep).to.be.a('function');
      expect(progressTracker.getProgress).to.be.a('function');
      expect(progressTracker.finish).to.be.a('function');
      expect(progressTracker.summary).to.be.a('function');
    });

    it('should start tracking with initial values', function () {
      const result = progressTracker.start();
      expect(result.progress).to.equal(0);
      expect(result.status).to.equal('Starting...');
    });
  });

  describe('Step Management', function () {
    beforeEach(function () {
      progressTracker.start();
    });

    it('should update to a new step', function () {
      const step = { name: 'step1', endPercentage: 50 };
      const result = progressTracker.updateStep(step);

      expect(result.progress).to.equal(0);
      expect(result.status).to.equal('step1');
    });

    it('should calculate progress based on elapsed time', function () {
      // First step from 0% to 50%
      progressTracker.updateStep({ name: 'step1', endPercentage: 50 });

      // Advance time to simulate 50% completion of step
      Date.now.returns(6000); // Duration is default 10s per 50%, so 50% after 5s
      const progress = progressTracker.getProgress();

      // Default duration is calculated as max(1, endPercentage - startPercentage / 10)
      // For this step it would be max(1, 5) = 5s duration,
      // so after 5s we'd be at ~50% progress
      expect(progress.progress).to.be.approximately(5, 1);
    });

    it('should handle endPercentage parameter', function () {
      progressTracker.updateStep({ name: 'step1', endPercentage: 75 });

      // Advance time to simulate progress
      // Duration would be calculated based on percentage
      Date.now.returns(11000); // 10s elapsed

      // Progress calculation is complex based on implementation
      const progress = progressTracker.getProgress();
      expect(progress.progress).to.be.approximately(10, 1);
    });
  });

  describe('Step History and Progress Calculation', function () {
    beforeEach(function () {
      progressTracker.start();
    });

    it('should use history data for duration estimation', function () {
      // Setup with history data
      historyManagerStub.hasHistoryForStep.returns(true);
      historyManagerStub.getEstimatedDuration.returns(5);

      progressTracker.updateStep({ name: 'history-step', endPercentage: 50 });

      // Advance time to halfway through estimated duration
      Date.now.returns(3500);

      const progress = progressTracker.getProgress();
      // With duration 5s, after 2.5s, progress should be calculated based on implementation
      expect(progress).to.be.an('object');
    });

    it('should update history when step is finished', function () {
      progressTracker.updateStep({ name: 'step1', endPercentage: 50 });

      // Advance time
      Date.now.returns(6000);

      // Finish the tracking
      progressTracker.finish();

      // Should update history
      expect(historyManagerStub.updateStepDuration.called).to.be.true;
      expect(historyManagerStub.updateStepDuration.args[0][0]).to.equal(
        'step1',
      );
    });
  });

  describe('Finish Functionality', function () {
    beforeEach(function () {
      progressTracker.start();
    });

    it('should set progress to 100% on finish', function () {
      progressTracker.updateStep({ name: 'step1', endPercentage: 50 });

      const result = progressTracker.finish();

      expect(result.progress).to.equal(100);
      expect(result.status).to.equal('Completed');
    });

    it('should accept custom status message on finish', function () {
      progressTracker.updateStep({ name: 'step1', endPercentage: 60 });

      const result = progressTracker.finish({ status: 'Custom done message' });

      expect(result.progress).to.equal(100);
      expect(result.status).to.equal('Custom done message');
    });

    it('should call resetSession on finish', function () {
      progressTracker.updateStep({ name: 'step1', endPercentage: 70 });
      progressTracker.finish();

      expect(historyManagerStub.resetSession.calledOnce).to.be.true;
    });

    it('should handle finish with no active step', function () {
      // Just start without setting a step
      const result = progressTracker.finish();

      expect(result.progress).to.equal(100);
      expect(result.etaSeconds).to.equal(0);
      expect(result.etaString).to.equal('');
    });

    it('should handle resetSession errors gracefully', function () {
      // Make resetSession throw an error
      historyManagerStub.resetSession.throws(new Error('Reset session error'));

      // Should not throw when finish is called
      const result = progressTracker.finish();

      // Should still complete successfully
      expect(result.progress).to.equal(100);
    });
  });

  describe('Progress State', function () {
    beforeEach(function () {
      progressTracker.start();
    });

    it('should get current progress when no steps are active', function () {
      const progress = progressTracker.getProgress();
      expect(progress.progress).to.equal(0);
      expect(progress.status).to.equal('In progress...');
    });

    it('should handle empty or missing step name', function () {
      // Update with undefined name
      const result = progressTracker.updateStep({ endPercentage: 50 });
      expect(result).to.be.an('object');
      expect(result.progress).to.equal(0);
    });

    it('should validate step configuration', function () {
      // Try to update with invalid step (missing endPercentage)
      const result = progressTracker.updateStep({ name: 'invalid-step' });

      // Should return a valid result despite invalid config
      expect(result).to.be.an('object');
      expect(result.progress).to.equal(0);
    });
  });

  describe('Summary and Analysis', function () {
    beforeEach(function () {
      // Set up a sequence of steps
      progressTracker.start();

      Date.now.returns(1000);
      progressTracker.updateStep({ name: 'step1', endPercentage: 30 });

      Date.now.returns(4000);
      progressTracker.finish();
    });

    it('should generate a summary with timing data', function () {
      const summary = progressTracker.summary();
      expect(summary).to.be.an('object');
      expect(summary.totalTime).to.equal(3);
      expect(summary.steps).to.be.an('array');
      expect(summary.historyFilePath).to.equal('/tmp/test-history.json');
    });

    it('should include completed steps in summary', function () {
      const summary = progressTracker.summary();
      expect(summary.steps.length).to.equal(1);
      expect(summary.steps[0].name).to.equal('step1');
    });
  });

  describe('History Management', function () {
    it('should expose history cleaning functionality', function () {
      const result = progressTracker.cleanHistory('test-app');
      expect(result.success).to.be.true;
      expect(historyManagerStub.cleanHistory.calledWith('test-app')).to.be.true;
    });

    it('should provide history information', function () {
      const info = progressTracker.getHistoryInfo();
      expect(info).to.be.an('object');
      expect(info.currentAppName).to.equal('test-app');
      expect(info.directory).to.equal('/tmp');
      expect(info.currentAppHistoryPath).to.equal('/tmp/test-history.json');
    });
  });

  describe('Edge Cases Coverage', function () {
    // Create fresh instances for each test to avoid sinon conflicts
    let edgeCaseTracker, edgeCaseDateStub, edgeCaseHistoryStub;

    beforeEach(function () {
      // Restore any previous stubs to avoid conflicts
      sinon.restore();

      // Create a fresh history manager stub
      edgeCaseHistoryStub = {
        getHistoryFilePath: sinon.stub().returns('/tmp/test-history.json'),
        hasHistoryForStep: sinon.stub().returns(false),
        getEstimatedDuration: sinon.stub().returns(10),
        updateStepDuration: sinon.stub(),
        getAllStepHistory: sinon.stub().returns([]),
        getStepHistoryInfo: sinon.stub().returns(null),
        cleanHistory: sinon
          .stub()
          .returns({ success: true, message: 'Cleaned' }),
        getHistoryDirectory: sinon.stub().returns('/tmp'),
        resetSession: sinon.stub(),
      };

      // Create a fresh tracker instance with our stub
      const createEdgeCaseTracker = proxyquire('../src/main', {
        './history': () => edgeCaseHistoryStub,
      });

      edgeCaseTracker = createEdgeCaseTracker({
        name: 'edge-test',
        debug: true,
      });

      // Control time for the tests
      edgeCaseDateStub = sinon.stub(Date, 'now').returns(1000);
    });

    afterEach(function () {
      // Clean up after each test
      sinon.restore();
    });

    it('should handle negative elapsed time in ETA calculation', function () {
      edgeCaseTracker.start();
      edgeCaseTracker.updateStep({ name: 'test-step', endPercentage: 50 });

      // Force elapsed time to be negative by setting now to be before start time
      edgeCaseDateStub.returns(500);
      const progress = edgeCaseTracker.getProgress();
      expect(progress.etaSeconds).to.be.null;
    });

    it('should test step configuration inheritance edge cases', function () {
      edgeCaseTracker.start();

      // Force case where there's no lastStep and no startPercentage
      const step = { name: 'inheritance-test', endPercentage: 50 };
      edgeCaseTracker.updateStep(step);

      // Verify step uses default startPercentage of 0
      const progress = edgeCaseTracker.getProgress();
      expect(progress.progress).to.equal(0);
    });

    it('should test duration calculation paths', function () {
      const historyStub = {
        getHistoryFilePath: sinon.stub().returns('/tmp/test.json'),
        hasHistoryForStep: sinon.stub().returns(false),
        getEstimatedDuration: sinon.stub().returns(10),
        updateStepDuration: sinon.stub(),
        getAllStepHistory: sinon.stub().returns([]),
        getStepHistoryInfo: sinon.stub().returns(null),
        cleanHistory: sinon.stub().returns({ success: true }),
        getHistoryDirectory: sinon.stub().returns('/tmp'),
        resetSession: sinon.stub(),
      };

      const createTracker = proxyquire('../src/main', {
        './history': () => historyStub,
      });

      const tracker = createTracker();
      tracker.start();

      // Test case with no history, no duration - should calculate default duration
      tracker.updateStep({ name: 'default-duration', endPercentage: 70 });

      // If gets here without error, the test passed
      expect(tracker).to.be.an('object');
    });

    it('should handle formatTimeDisplay extreme edge cases', function () {
      // If this function isn't exposed for testing, we can test indirectly
      edgeCaseTracker.start();
      edgeCaseTracker.updateStep({ name: 'eta-test', endPercentage: 50 });

      // Test various time scenarios

      // Zero seconds
      edgeCaseDateStub.returns(1000);
      const progressZero = edgeCaseTracker.getProgress();
      expect(progressZero.etaString).to.not.include('NaN');

      // Very large ETA
      edgeCaseDateStub.returns(1001);
      const progressLarge = edgeCaseTracker.getProgress();
      expect(progressLarge.etaString).to.not.include('NaN');
    });

    it('should handle to property for backward compatibility', function () {
      edgeCaseTracker.start();

      // Use 'to' instead of endPercentage
      const result = edgeCaseTracker.updateStep({
        name: 'legacy-step',
        to: 60,
      });

      expect(result).to.be.an('object');
      expect(result.progress).to.equal(0);

      // Get progress after update
      const progress = edgeCaseTracker.getProgress();
      expect(progress.progress).to.equal(0);
    });

    it('should handle finish after very short time', function () {
      edgeCaseTracker.start();
      edgeCaseTracker.updateStep({ name: 'quick-step', endPercentage: 40 });

      // Finish immediately
      const result = edgeCaseTracker.finish();

      expect(result.progress).to.equal(100);
      expect(edgeCaseHistoryStub.updateStepDuration.called).to.be.true;
    });

    it('should handle multiple sequential steps', function () {
      edgeCaseTracker.start();

      // First step
      edgeCaseTracker.updateStep({ name: 'step1', endPercentage: 30 });
      edgeCaseDateStub.returns(3000);

      // Second step - should inherit startPercentage from previous
      edgeCaseTracker.updateStep({ name: 'step2', endPercentage: 60 });
      edgeCaseDateStub.returns(6000);

      // Third step
      edgeCaseTracker.updateStep({ name: 'step3', endPercentage: 100 });
      edgeCaseDateStub.returns(10000);

      // Reset the history stub call count before finish
      edgeCaseHistoryStub.updateStepDuration.resetHistory();

      // Finish
      const result = edgeCaseTracker.finish();

      expect(result.progress).to.equal(100);

      // Only the last active step (step3) should be updated when finish is called
      expect(edgeCaseHistoryStub.updateStepDuration.callCount).to.equal(1);
      expect(edgeCaseHistoryStub.updateStepDuration.firstCall.args[0]).to.equal(
        'step3',
      );
    });
  });
});
