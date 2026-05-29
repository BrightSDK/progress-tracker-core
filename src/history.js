// LICENSE_CODE ZON
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const pkg = require('../package.json');

/**
 * Creates a history manager for progress tracker
 * @param {Object} options - Configuration options
 * @param {string} [options.name] - Name for the history file
 * @param {boolean} [options.debug] - Whether to output debug information
 * @returns {Object} History manager
 */
function createHistoryManager(options = {}) {
  const { name = 'app', debug = false } = options;

  // Sanitize name to prevent path traversal
  const safeName = String(name)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);

  let stepDurationHistory = {};
  let historyFilePath = null;

  // Create stats directory in system temp if name provided
  if (safeName) {
    const statsDir = path.join(os.tmpdir(), pkg.name);
    try {
      if (!fs.existsSync(statsDir)) {
        fs.mkdirSync(statsDir, { recursive: true });
      }
      historyFilePath = path.join(statsDir, `${safeName}-history.json`);
    } catch (error) {
      console.warn(
        `Warning: Could not create stats directory: ${error.message}`,
      );
    }
  }

  // Try to load history if file path exists
  if (historyFilePath) {
    try {
      if (fs.existsSync(historyFilePath)) {
        const stat = fs.statSync(historyFilePath);
        if (stat.size > 1024 * 1024) {
          console.warn(
            `Warning: History file too large (${stat.size} bytes), resetting`,
          );
          fs.unlinkSync(historyFilePath);
        } else {
          const historyData = fs.readFileSync(historyFilePath, 'utf8');
          stepDurationHistory = JSON.parse(historyData);
          if (debug) {
            console.log(
              `Loaded progress history for "${safeName}" from ${historyFilePath}`,
            );
            console.log(
              `History contains ${Object.keys(stepDurationHistory).length} steps`,
            );
          }
        }
      }
    } catch (error) {
      console.warn(
        `Warning: Could not load progress history for "${safeName}": ${error.message}`,
      );
      stepDurationHistory = {};
    }
  }

  return {
    /**
     * Get the history file path
     * @returns {string|null} The history file path or null if not using history
     */
    getHistoryFilePath: () => historyFilePath,

    /**
     * Check if history exists for the given step
     * @param {string} stepName - Name of the step
     * @returns {boolean} Whether history data exists for the step
     */
    hasHistoryForStep: stepName => {
      return !!(
        stepDurationHistory[stepName] &&
        Array.isArray(stepDurationHistory[stepName].samples) &&
        stepDurationHistory[stepName].samples.length > 0
      );
    },

    /**
     * Get estimated duration from history
     * @param {string} stepName - Name of the step
     * @param {number} configuredDuration - Fallback duration if no history
     * @returns {number} Estimated duration in seconds
     */
    getEstimatedDuration: (stepName, configuredDuration) => {
      // Simplify for better coverage
      const safeConfiguredDuration =
        typeof configuredDuration === 'number' && !isNaN(configuredDuration)
          ? configuredDuration
          : 0;

      // Combine all checks for better coverage
      if (
        !stepDurationHistory[stepName] ||
        !Array.isArray(stepDurationHistory[stepName].samples) ||
        stepDurationHistory[stepName].samples.length === 0
      ) {
        return safeConfiguredDuration;
      }

      const history = stepDurationHistory[stepName];

      // Calculate weighted average, giving more weight to recent samples
      const totalWeight = history.samples.reduce(
        (sum, _, i) => sum + (i + 1),
        0,
      );
      const weightedSum = history.samples.reduce((sum, duration, i) => {
        const weight = (i + 1) / totalWeight; // More recent samples get higher weight
        return sum + duration * weight;
      }, 0);

      // Blend with configured duration (70% history, 30% configured) to be more adaptive
      const blendedDuration = weightedSum * 0.7 + safeConfiguredDuration * 0.3;

      if (debug) {
        console.log(
          `History for "${stepName}": avg=${(
            history.samples.reduce((a, b) => a + b, 0) / history.samples.length
          ).toFixed(
            1,
          )}s, samples=${history.samples.length}, using: ${blendedDuration.toFixed(1)}s`,
        );
      }

      return blendedDuration;
    },

    /**
     * Update step duration history
     * @param {string} stepName - Name of the step
     * @param {number} estimatedDuration - Estimated duration
     * @param {number} actualDuration - Actual duration
     */
    updateStepDuration: (stepName, estimatedDuration, actualDuration) => {
      if (!historyFilePath) return;

      // Simplify for better coverage
      const safeEstimatedDuration =
        typeof estimatedDuration === 'number' && !isNaN(estimatedDuration)
          ? estimatedDuration
          : 1;
      const safeActualDuration =
        typeof actualDuration === 'number' &&
        !isNaN(actualDuration) &&
        actualDuration > 0
          ? actualDuration
          : 0.001;

      // Initialize history entry if it doesn't exist
      if (!stepDurationHistory[stepName]) {
        stepDurationHistory[stepName] = {
          samples: [],
          avgRatio: 1.0,
          runId: null, // Track the current run
        };
      }

      // Generate a unique run ID for this session if needed
      if (!stepDurationHistory.runSessionId) {
        stepDurationHistory.runSessionId = Date.now().toString();
      }

      // Check if this step has already been recorded for the current run
      // If so, update the existing sample instead of adding a new one
      if (
        stepDurationHistory[stepName].runId === stepDurationHistory.runSessionId
      ) {
        const lastIndex = stepDurationHistory[stepName].samples.length - 1;
        // Update the most recent sample instead of adding a new one
        if (lastIndex >= 0) {
          stepDurationHistory[stepName].samples[lastIndex] = actualDuration;
          if (debug) {
            console.log(
              `Updated existing sample for step "${stepName}": actual=${actualDuration.toFixed(1)}s`,
            );
          }
        } else {
          // Should never happen, but just in case
          stepDurationHistory[stepName].samples.push(actualDuration);
        }
      } else {
        // Add the new sample for a new run (limit to last 10 samples)
        stepDurationHistory[stepName].samples.push(actualDuration);
        if (stepDurationHistory[stepName].samples.length > 10) {
          stepDurationHistory[stepName].samples.shift(); // Remove oldest sample
        }

        // Mark this step as recorded for the current run
        stepDurationHistory[stepName].runId = stepDurationHistory.runSessionId;
      }

      // Calculate ratio more simply
      const ratio = safeEstimatedDuration / safeActualDuration;
      stepDurationHistory[stepName].avgRatio =
        stepDurationHistory[stepName].avgRatio * 0.5 + ratio * 0.5; // More weight to new ratio

      if (debug) {
        console.log(
          `Updated history for step "${stepName}": actual=${safeActualDuration.toFixed(1)}s, ` +
            `estimated=${safeEstimatedDuration.toFixed(1)}s, ratio=${ratio.toFixed(2)}`,
        );
      }

      // Save updated history immediately
      if (historyFilePath) {
        try {
          fs.writeFileSync(
            historyFilePath,
            JSON.stringify(stepDurationHistory, null, 2),
            'utf8',
          );
          if (debug) {
            console.log(`Saved progress history to ${historyFilePath}`);
          }
        } catch (error) {
          console.warn(
            `Warning: Could not save progress history for "${name}": ${error.message}`,
          );
        }
      }
    },

    /**
     * Get all step history data
     * @returns {Object} History data for all steps
     */
    getAllStepHistory: () => {
      return (
        Object.keys(stepDurationHistory)
          // Filter out non-step properties like runSessionId
          .filter(
            key =>
              stepDurationHistory[key] &&
              typeof stepDurationHistory[key] === 'object' &&
              Array.isArray(stepDurationHistory[key].samples),
          )
          .map(name => {
            // Handle case where samples might be empty
            const samples = stepDurationHistory[name].samples || [];
            const average =
              samples.length > 0
                ? samples.reduce((a, b) => a + b, 0) / samples.length
                : 0;

            return {
              name,
              samples,
              average,
            };
          })
      );
    },

    /**
     * Get history info for a specific step
     * @param {string} stepName - Name of the step
     * @returns {Object|null} History info or null if no history
     */
    getStepHistoryInfo: stepName => {
      if (
        !stepDurationHistory[stepName] ||
        !Array.isArray(stepDurationHistory[stepName].samples) ||
        stepDurationHistory[stepName].samples.length === 0
      ) {
        return null;
      }

      const samples = stepDurationHistory[stepName].samples;
      return {
        historyAverage: samples.reduce((a, b) => a + b, 0) / samples.length,
        samples: samples.length,
      };
    },

    /**
     * Clean up history data for this app or a specified app
     * @param {string} [appNameToClean] - Optional app name to clean (defaults to current app)
     * @returns {Object} Result with success status and message
     */
    cleanHistory: appNameToClean => {
      const nameToClean = appNameToClean || safeName;
      const safeNameToClean = String(nameToClean)
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 64);
      const fileToClean =
        safeNameToClean === safeName
          ? historyFilePath
          : path.join(os.tmpdir(), pkg.name, `${safeNameToClean}-history.json`);

      if (!fileToClean) {
        return {
          success: false,
          message: 'No history file path available',
        };
      }

      try {
        // Simplify error handling for better coverage
        if (!fs.existsSync(fileToClean)) {
          return {
            success: true,
            message: `No history file found at: ${fileToClean}`,
            path: fileToClean,
          };
        }

        try {
          fs.unlinkSync(fileToClean);
        } catch (error) {
          return {
            success: false,
            message: `Error deleting history file: ${error.message}`,
            error,
            path: fileToClean,
          };
        }

        // Reset in-memory history if cleaning current app
        if (safeNameToClean === safeName) {
          stepDurationHistory = {};
        }

        return {
          success: true,
          message: `Successfully deleted history file: ${fileToClean}`,
          path: fileToClean,
        };
      } catch (error) {
        return {
          success: false,
          message: `Error checking history file: ${error.message}`,
          error,
          path: fileToClean,
        };
      }
    },

    /**
     * Reset the current session ID to ensure next run creates new samples
     */
    resetSession: () => {
      // Reset the runSessionId to force new samples on next run
      if (stepDurationHistory) {
        stepDurationHistory.runSessionId = null;

        if (debug) {
          console.log('Reset session ID to ensure new samples on next run');
        }

        // Save updated history
        if (historyFilePath) {
          try {
            fs.writeFileSync(
              historyFilePath,
              JSON.stringify(stepDurationHistory, null, 2),
              'utf8',
            );
            if (debug) {
              console.log(`Saved updated session state to ${historyFilePath}`);
            }
          } catch (error) {
            console.warn(
              `Warning: Could not save updated session state: ${error.message}`,
            );
          }
        }
      }
    },

    /**
     * Get the base directory for history files
     * @returns {string} Directory path
     */
    getHistoryDirectory: () => {
      return path.join(os.tmpdir(), pkg.name);
    },
  };
}

module.exports = createHistoryManager;
