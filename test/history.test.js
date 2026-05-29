// LICENSE_CODE ZON
'use strict';
const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const path = require('path');

describe('Progress Tracker - History Manager', function () {
  // Stubs for fs, path, and os modules
  let fsStub, pathStub, osStub;
  let createHistoryManager, historyManager;

  beforeEach(function () {
    // Set up filesystem stub
    fsStub = {
      existsSync: sinon.stub().returns(true),
      mkdirSync: sinon.stub(),
      readFileSync: sinon.stub().returns('{}'),
      writeFileSync: sinon.stub(),
      unlinkSync: sinon.stub(),
      statSync: sinon.stub().returns({ size: 100 }),
    };

    // Set up path stub
    pathStub = {
      join: path.join,
      dirname: path.dirname,
    };

    // Set up os stub
    osStub = {
      tmpdir: sinon.stub().returns('/tmp'),
    };

    // Create the module with our stubs
    createHistoryManager = proxyquire('../src/history', {
      fs: fsStub,
      path: pathStub,
      os: osStub,
      '../package.json': { name: 'test-package' },
    });

    // Create a history manager instance with debug enabled
    historyManager = createHistoryManager({
      name: 'test-app',
      debug: true,
    });
  });

  afterEach(function () {
    sinon.restore();
  });

  describe('Initialization', function () {
    it('should create a history manager with expected methods', function () {
      expect(historyManager).to.be.an('object');
      expect(historyManager.getHistoryFilePath).to.be.a('function');
      expect(historyManager.hasHistoryForStep).to.be.a('function');
      expect(historyManager.getEstimatedDuration).to.be.a('function');
      expect(historyManager.updateStepDuration).to.be.a('function');
      expect(historyManager.resetSession).to.be.a('function');
      expect(historyManager.cleanHistory).to.be.a('function');
    });

    it('should create directory if it does not exist', function () {
      fsStub.existsSync.returns(false);

      historyManager = createHistoryManager({
        name: 'test-app',
        debug: true,
      });

      expect(fsStub.mkdirSync.called).to.be.true;
    });

    it('should handle errors during directory creation', function () {
      fsStub.existsSync.returns(false);
      fsStub.mkdirSync.throws(new Error('Permission denied'));

      // Stub console.warn instead of console.error as the implementation uses warn
      const consoleWarnStub = sinon.stub(console, 'warn');

      historyManager = createHistoryManager({
        name: 'test-app',
        debug: true,
      });

      expect(consoleWarnStub.called).to.be.true;
      expect(consoleWarnStub.args[0][0]).to.include(
        'Could not create stats directory',
      );
    });
  });

  describe('Step History Management', function () {
    it('should check if history exists for a step', function () {
      // Setup existing step in history
      const historyData = {
        'test-step': {
          samples: [5.1],
        },
      };
      fsStub.readFileSync.returns(JSON.stringify(historyData));

      // Create a new instance that will use our mocked history data
      const testHistoryManager = createHistoryManager({
        name: 'test-app',
        debug: true,
      });

      expect(testHistoryManager.hasHistoryForStep('test-step')).to.be.true;
      expect(testHistoryManager.hasHistoryForStep('non-existent-step')).to.be
        .false;
    });

    it('should get estimated duration from history', function () {
      // Setup step with history data
      const historyData = {
        'test-step': {
          samples: [5.0, 5.2, 5.4],
        },
      };
      fsStub.readFileSync.returns(JSON.stringify(historyData));

      // Create a new instance that will use our mocked history data
      const testHistoryManager = createHistoryManager({
        name: 'test-app',
        debug: true,
      });

      // With 70% history and 30% configured, expect ~5.2 * 0.7 + 10 * 0.3 = ~6.64
      const duration = testHistoryManager.getEstimatedDuration('test-step', 10);
      expect(duration).to.be.approximately(6.6, 0.5);
    });

    it('should return configured duration when no history exists', function () {
      const duration = historyManager.getEstimatedDuration(
        'non-existent-step',
        8,
      );
      expect(duration).to.equal(8);
    });

    it('should handle invalid history data', function () {
      // Setup corrupted history data
      fsStub.readFileSync.returns('{"corrupted":');

      const duration = historyManager.getEstimatedDuration('any-step', 7);
      expect(duration).to.equal(7); // Should fall back to configured duration
    });
  });

  describe('Session Management', function () {
    it('should update step duration and track session ID', function () {
      // Setup initial step data
      fsStub.readFileSync.returns('{}');

      // First update creates the step entry and sets the run session ID
      historyManager.updateStepDuration('step1', 10, 8);

      // Check that writeFileSync was called with session ID data
      expect(fsStub.writeFileSync.called).to.be.true;
      const writeArgs = fsStub.writeFileSync.args[0];
      const writtenData = JSON.parse(writeArgs[1]);

      expect(writtenData).to.have.property('runSessionId');
      expect(writtenData).to.have.property('step1');
      expect(writtenData.step1).to.have.property('samples').that.includes(8);
      expect(writtenData.step1)
        .to.have.property('runId')
        .that.equals(writtenData.runSessionId);

      // Store the runSessionId for next test
      const sessionId = writtenData.runSessionId;

      // Reset stubs for next call
      fsStub.writeFileSync.reset();
      fsStub.readFileSync.returns(JSON.stringify(writtenData));

      // Update another step in the same session
      historyManager.updateStepDuration('step2', 5, 6);

      // Check that second step uses same session ID
      const secondWriteArgs = fsStub.writeFileSync.args[0];
      const secondWrittenData = JSON.parse(secondWriteArgs[1]);

      expect(secondWrittenData.runSessionId).to.equal(sessionId);
      expect(secondWrittenData).to.have.property('step2');
    });

    it('should reset session ID', function () {
      // Setup initial data with session ID
      const initialData = {
        runSessionId: '12345',
        step1: {
          samples: [5],
          runId: '12345',
        },
      };

      fsStub.readFileSync.returns(JSON.stringify(initialData));

      // Reset the session
      historyManager.resetSession();

      // Verify session ID was reset
      expect(fsStub.writeFileSync.called).to.be.true;
      const writeArgs = fsStub.writeFileSync.args[0];
      const writtenData = JSON.parse(writeArgs[1]);

      expect(writtenData.runSessionId).to.be.null;
    });

    it('should handle errors during session reset', function () {
      // Make writeFileSync throw an error
      fsStub.writeFileSync.throws(new Error('Write error'));

      // Should not throw
      expect(() => historyManager.resetSession()).not.to.throw();
    });

    it('should maintain sample history across resets', function () {
      // Setup history with existing samples
      const initialData = {
        runSessionId: '12345',
        step1: {
          samples: [5, 6, 7],
          runId: '12345',
        },
      };

      fsStub.readFileSync.returns(JSON.stringify(initialData));

      // Create a new instance that will use our mocked history data
      const testHistoryManager = createHistoryManager({
        name: 'test-app',
        debug: true,
      });

      // Reset session
      testHistoryManager.resetSession();

      // Check that samples were preserved
      const writeArgs = fsStub.writeFileSync.args[0];
      const writtenData = JSON.parse(writeArgs[1]);

      expect(writtenData.runSessionId).to.be.null;
      expect(writtenData.step1.samples).to.deep.equal([5, 6, 7]);
    });
  });

  describe('Sample Management', function () {
    it('should accumulate samples up to maximum limit', function () {
      // Setup initial data with 9 samples (one less than max)
      const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      const initialData = {
        runSessionId: null,
        step1: {
          samples: samples,
          runId: null,
        },
      };
      fsStub.readFileSync.returns(JSON.stringify(initialData));

      // Create a new instance that will use our mocked history data
      const testHistoryManager = createHistoryManager({
        name: 'test-app',
        debug: true,
      });

      // Add a new sample
      testHistoryManager.updateStepDuration('step1', 10, 10);

      // Check that samples were updated properly
      const writeArgs = fsStub.writeFileSync.args[0];
      const writtenData = JSON.parse(writeArgs[1]);

      expect(writtenData.step1.samples.length).to.equal(10); // Max is 10
      expect(writtenData.step1.samples).to.include(10); // New sample
      expect(writtenData.step1.samples[9]).to.equal(10); // New sample at end
      expect(writtenData.step1.samples[0]).to.equal(1); // First sample preserved
    });

    it('should update existing sample if in same run session', function () {
      // Setup data with existing run session
      const sessionId = Date.now().toString();
      const initialData = {
        runSessionId: sessionId,
        step1: {
          samples: [5],
          runId: sessionId,
        },
      };
      fsStub.readFileSync.returns(JSON.stringify(initialData));

      // Create a new instance that will use our mocked history data
      const testHistoryManager = createHistoryManager({
        name: 'test-app',
        debug: true,
      });

      // Update same step in same session
      testHistoryManager.updateStepDuration('step1', 10, 7);

      // Check that sample was updated, not added
      const writeArgs = fsStub.writeFileSync.args[0];
      const writtenData = JSON.parse(writeArgs[1]);

      expect(writtenData.step1.samples.length).to.equal(1);
      expect(writtenData.step1.samples[0]).to.equal(7); // Updated value
    });

    it('should add new sample after resetting session', function () {
      // Setup initial data
      const initialSessionId = 'old-session';
      const initialData = {
        runSessionId: initialSessionId,
        step1: {
          samples: [5],
          runId: initialSessionId,
        },
      };
      fsStub.readFileSync.returns(JSON.stringify(initialData));

      // Create a new instance that will use our mocked history data
      const testHistoryManager = createHistoryManager({
        name: 'test-app',
        debug: true,
      });

      // Reset session
      testHistoryManager.resetSession();

      // Update stubs to return data after reset
      const resetData = JSON.parse(fsStub.writeFileSync.args[0][1]);
      fsStub.readFileSync.returns(JSON.stringify(resetData));
      fsStub.writeFileSync.reset();

      // Update step after reset
      testHistoryManager.updateStepDuration('step1', 10, 8);

      // Should add a new sample, not update existing
      const writeArgs = fsStub.writeFileSync.args[0];
      const writtenData = JSON.parse(writeArgs[1]);

      expect(writtenData.step1.samples.length).to.equal(2);
      expect(writtenData.step1.samples).to.deep.include(5); // Old sample
      expect(writtenData.step1.samples).to.deep.include(8); // New sample
    });
  });

  describe('History Cleaning', function () {
    it('should clean history for the specified app', function () {
      const result = historyManager.cleanHistory('test-app');

      expect(result.success).to.be.true;
      expect(fsStub.unlinkSync.called).to.be.true;
    });

    it('should clean current app history if no app specified', function () {
      const result = historyManager.cleanHistory();

      expect(result.success).to.be.true;
      expect(fsStub.unlinkSync.called).to.be.true;
    });

    it('should handle errors during history cleaning', function () {
      fsStub.unlinkSync.throws(new Error('Permission denied'));

      const result = historyManager.cleanHistory();

      expect(result.success).to.be.false;
      expect(result.message).to.include('Error deleting history file');
    });

    it('should handle non-existent history file', function () {
      fsStub.existsSync.returns(false);

      const result = historyManager.cleanHistory();

      expect(result.success).to.be.true;
      expect(result.message).to.include('No history file found at');
    });
  });

  describe('History Info', function () {
    it('should get history directory', function () {
      const dir = historyManager.getHistoryDirectory();
      expect(dir).to.equal('/tmp/test-package');
    });

    it('should get history file path', function () {
      const filePath = historyManager.getHistoryFilePath();
      expect(filePath).to.include('test-app-history.json');
    });

    it('should get all step history', function () {
      // Setup history data with steps
      const historyData = {
        runSessionId: null,
        step1: { samples: [1, 2, 3] },
        step2: { samples: [4, 5] },
      };
      fsStub.readFileSync.returns(JSON.stringify(historyData));

      // Create a new instance that will use our mocked history data
      const testHistoryManager = createHistoryManager({
        name: 'test-app',
        debug: true,
      });

      const allHistory = testHistoryManager.getAllStepHistory();

      expect(allHistory).to.be.an('array');
      expect(allHistory.length).to.equal(2);
      expect(allHistory[0].name).to.be.oneOf(['step1', 'step2']);
      expect(allHistory[1].name).to.be.oneOf(['step1', 'step2']);
    });

    it('should get specific step history info', function () {
      // Setup history data with step
      const historyData = {
        runSessionId: null,
        step1: { samples: [1, 2, 3] },
      };
      fsStub.readFileSync.returns(JSON.stringify(historyData));

      // Create a new instance that will use our mocked history data
      const testHistoryManager = createHistoryManager({
        name: 'test-app',
        debug: true,
      });

      const stepInfo = testHistoryManager.getStepHistoryInfo('step1');

      expect(stepInfo).to.be.an('object');
      expect(stepInfo).to.have.property('samples');
      expect(stepInfo.samples).to.equal(3);
    });

    it('should return null for non-existent step history', function () {
      const stepInfo = historyManager.getStepHistoryInfo('non-existent');
      expect(stepInfo).to.be.null;
    });
  });
});
