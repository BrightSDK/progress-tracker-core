// LICENSE_CODE ZON
'use strict';
const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

describe('History Manager', function() {
  let createHistoryManager, fsStub, historyManager, tempDir;

  beforeEach(function() {
    // Setup temp directory path
    tempDir = '/tmp/test-history';

    // Create stubs
    fsStub = {
      existsSync: sinon.stub().returns(true),
      mkdirSync: sinon.stub(),
      readFileSync: sinon.stub().returns('{}'),
      writeFileSync: sinon.stub(),
      unlinkSync: sinon.stub()
    };

    // Use proxyquire to mock fs and path dependencies
    createHistoryManager = proxyquire('../src/history', {
      'fs': fsStub,
      'path': {
        join: (...args) => args.join('/'),
        dirname: (p) => p.split('/').slice(0, -1).join('/')
      },
      'os': {
        tmpdir: () => '/tmp'
      },
      '../package.json': { name: 'test-pkg' }
    });
  });

  afterEach(function() {
    sinon.restore();
  });

  describe('Initialization', function() {
    it('should create a history manager with default values', function() {
      historyManager = createHistoryManager();
      expect(historyManager).to.be.an('object');
      expect(historyManager.getHistoryFilePath()).to.equal('/tmp/test-pkg/app-history.json');
    });

    it('should use provided app name', function() {
      historyManager = createHistoryManager({ name: 'test-app' });
      expect(historyManager.getHistoryFilePath()).to.equal('/tmp/test-pkg/test-app-history.json');
    });

    it('should handle file system errors gracefully', function() {
      fsStub.existsSync.throws(new Error('Test file system error'));
      historyManager = createHistoryManager();
      expect(historyManager).to.be.an('object'); // Should still create an object despite errors
    });

    it('should load history data if file exists', function() {
      fsStub.readFileSync.returns(JSON.stringify({
        'step1': { samples: [1, 2, 3], avgRatio: 1.5 }
      }));

      historyManager = createHistoryManager({ debug: true });
      expect(historyManager.hasHistoryForStep('step1')).to.be.true;
    });

    it('should handle corrupt history data', function() {
      fsStub.readFileSync.returns('invalid json');
      historyManager = createHistoryManager();
      expect(historyManager.hasHistoryForStep('step1')).to.be.false;
    });
  });

  describe('History Operations', function() {
    beforeEach(function() {
      fsStub.readFileSync.returns(JSON.stringify({
        'existingStep': { samples: [2, 3, 4], avgRatio: 1.2 }
      }));
      historyManager = createHistoryManager();
    });

    it('should check if history exists for a step', function() {
      expect(historyManager.hasHistoryForStep('existingStep')).to.be.true;
      expect(historyManager.hasHistoryForStep('nonExistingStep')).to.be.false;
    });

    it('should get estimated duration from history', function() {
      const duration = historyManager.getEstimatedDuration('existingStep', 5);
      // The calculation is weighted with more recent samples having higher weight:
      // We have samples [2,3,4] with weights increasing for newer samples
      // Then blended with 70% of weighted avg + 30% of 5
      expect(duration).to.be.closeTo(3.8, 0.1); // Adjusted to match actual calculation

      // Should fallback to provided duration if no history
      expect(historyManager.getEstimatedDuration('nonExistingStep', 10)).to.equal(10);
    });

    it('should update step duration and save history', function() {
      historyManager.updateStepDuration('newStep', 5, 4);
      expect(fsStub.writeFileSync.calledOnce).to.be.true;

      // Should have created history for the new step
      expect(historyManager.hasHistoryForStep('newStep')).to.be.true;
    });

    it('should limit history samples to the latest 10', function() {
      // Setup history with 10 samples
      const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      fsStub.readFileSync.returns(JSON.stringify({
        'fullStep': { samples, avgRatio: 1.0 }
      }));

      historyManager = createHistoryManager();
      historyManager.updateStepDuration('fullStep', 11, 11);

      // Get the updated history
      const allHistory = historyManager.getAllStepHistory();
      const fullStepHistory = allHistory.find(h => h.name === 'fullStep');

      expect(fullStepHistory.samples).to.have.lengthOf(10);
      expect(fullStepHistory.samples).to.not.include(1); // Oldest should be removed
      expect(fullStepHistory.samples).to.include(11); // New one should be added
    });

    it('should handle missing or invalid durations gracefully', function() {
      historyManager.updateStepDuration('newStep', undefined, 4);
      // Should use actual duration as estimated when estimated is not provided
      expect(historyManager.hasHistoryForStep('newStep')).to.be.true;

      historyManager.updateStepDuration('anotherStep', 5, undefined);
      // Should handle undefined actual durations
      expect(historyManager.hasHistoryForStep('anotherStep')).to.be.true;
    });
  });

  describe('Cleanup Operations', function() {
    beforeEach(function() {
      historyManager = createHistoryManager({ name: 'test-app' });
    });

    it('should clean history for the current app', function() {
      const result = historyManager.cleanHistory();
      expect(result.success).to.be.true;
      expect(fsStub.unlinkSync.calledWith('/tmp/test-pkg/test-app-history.json')).to.be.true;
    });

    it('should clean history for a specified app', function() {
      const result = historyManager.cleanHistory('other-app');
      expect(result.success).to.be.true;
      expect(fsStub.unlinkSync.calledWith('/tmp/test-pkg/other-app-history.json')).to.be.true;
    });

    it('should handle errors when cleaning history', function() {
      fsStub.unlinkSync.throws(new Error('Test unlink error'));
      const result = historyManager.cleanHistory();
      expect(result.success).to.be.false;
      expect(result.message).to.include('Test unlink error');
    });

    it('should handle case when history file does not exist', function() {
      fsStub.existsSync.returns(false);
      const result = historyManager.cleanHistory();
      expect(result.success).to.be.true;
      expect(result.message).to.include('No history file found');
      expect(fsStub.unlinkSync.called).to.be.false;
    });
  });

  describe('History Info', function() {
    beforeEach(function() {
      historyManager = createHistoryManager({ name: 'test-app' });
    });

    it('should get all step history data', function() {
      fsStub.readFileSync.returns(JSON.stringify({
        'step1': { samples: [1, 2, 3], avgRatio: 1.0 },
        'step2': { samples: [4, 5], avgRatio: 1.2 }
      }));

      historyManager = createHistoryManager();
      const allHistory = historyManager.getAllStepHistory();

      expect(allHistory).to.have.lengthOf(2);
      expect(allHistory[0].name).to.equal('step1');
      expect(allHistory[0].average).to.equal(2);
      expect(allHistory[1].name).to.equal('step2');
      expect(allHistory[1].average).to.equal(4.5);
    });

    it('should get history info for a specific step', function() {
      fsStub.readFileSync.returns(JSON.stringify({
        'step1': { samples: [1, 2, 3], avgRatio: 1.0 }
      }));

      historyManager = createHistoryManager();
      const info = historyManager.getStepHistoryInfo('step1');

      expect(info).to.be.an('object');
      expect(info.historyAverage).to.equal(2);
      expect(info.samples).to.equal(3);
    });

    it('should return null for non-existing step history info', function() {
      expect(historyManager.getStepHistoryInfo('nonExistingStep')).to.be.null;
    });

    it('should get the history directory', function() {
      expect(historyManager.getHistoryDirectory()).to.equal('/tmp/test-pkg');
    });
  });
});
