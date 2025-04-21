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

    let stepDurationHistory = {};
    let historyFilePath = null;

    // Create stats directory in system temp if name provided
    if (name) {
        const statsDir = path.join(os.tmpdir(), pkg.name);
        try {
            if (!fs.existsSync(statsDir)) {
                fs.mkdirSync(statsDir, { recursive: true });
            }
            historyFilePath = path.join(statsDir, `${name}-history.json`);
        } catch (error) {
            console.warn(`Warning: Could not create stats directory: ${error.message}`);
        }
    }

    // Try to load history if file path exists
    if (historyFilePath) {
        try {
            if (fs.existsSync(historyFilePath)) {
                const historyData = fs.readFileSync(historyFilePath, 'utf8');
                stepDurationHistory = JSON.parse(historyData);
                if (debug) {
                    console.log(`Loaded progress history for "${name}" from ${historyFilePath}`);
                    console.log(`History contains ${Object.keys(stepDurationHistory).length} steps`);
                }
            }
        } catch (error) {
            console.warn(`Warning: Could not load progress history for "${name}": ${error.message}`);
            // Initialize an empty history on error
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
        hasHistoryForStep: (stepName) => {
            return !!(stepDurationHistory[stepName] &&
                    stepDurationHistory[stepName].samples &&
                    stepDurationHistory[stepName].samples.length > 0);
        },

        /**
         * Get estimated duration from history
         * @param {string} stepName - Name of the step
         * @param {number} configuredDuration - Fallback duration if no history
         * @returns {number} Estimated duration in seconds
         */
        getEstimatedDuration: (stepName, configuredDuration) => {
            if (!stepDurationHistory[stepName] || !stepDurationHistory[stepName].samples ||
                stepDurationHistory[stepName].samples.length === 0) {
                if (debug) {
                    console.log(`No history found for step "${stepName}", using configured duration: ${configuredDuration}s`);
                }
                return configuredDuration;
            }

            const history = stepDurationHistory[stepName];
            // Calculate weighted average, giving more weight to recent samples
            const totalWeight = history.samples.reduce((sum, _, i) => sum + (i + 1), 0);
            const weightedSum = history.samples.reduce((sum, duration, i) => {
                const weight = (i + 1) / totalWeight; // More recent samples get higher weight
                return sum + (duration * weight);
            }, 0);

            // Blend with configured duration (70% history, 30% configured) to be more adaptive
            const blendedDuration = weightedSum * 0.7 + configuredDuration * 0.3;

            if (debug) {
                console.log(`History for "${stepName}": avg=${(history.samples.reduce((a,b) => a+b, 0) /
                            history.samples.length).toFixed(1)}s, samples=${history.samples.length}, using: ${blendedDuration.toFixed(1)}s`);
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

            // Ensure we have valid durations
            const safeEstimatedDuration = estimatedDuration !== undefined ?
                estimatedDuration : actualDuration || 1;

            // Initialize history entry if it doesn't exist
            if (!stepDurationHistory[stepName]) {
                stepDurationHistory[stepName] = {
                    samples: [],
                    avgRatio: 1.0
                };
            }

            // Add the new sample (limit to last 10 samples to maintain reasonable history size)
            stepDurationHistory[stepName].samples.push(actualDuration);
            if (stepDurationHistory[stepName].samples.length > 10) {
                stepDurationHistory[stepName].samples.shift(); // Remove oldest sample
            }

            // Calculate new average ratio
            const ratio = actualDuration > 0 ? safeEstimatedDuration / actualDuration : 1.0;
            stepDurationHistory[stepName].avgRatio =
                (stepDurationHistory[stepName].avgRatio * 0.5) + (ratio * 0.5); // More weight to new ratio

            if (debug) {
                console.log(`Updated history for step "${stepName}": actual=${actualDuration.toFixed(1)}s, ` +
                          `estimated=${safeEstimatedDuration.toFixed(1)}s, ratio=${ratio.toFixed(2)}`);
            }

            // Save updated history immediately
            if (historyFilePath) {
                try {
                    fs.writeFileSync(historyFilePath, JSON.stringify(stepDurationHistory, null, 2), 'utf8');
                    if (debug) {
                        console.log(`Saved progress history to ${historyFilePath}`);
                    }
                } catch (error) {
                    console.warn(`Warning: Could not save progress history for "${name}": ${error.message}`);
                }
            }
        },

        /**
         * Get all step history data
         * @returns {Object} History data for all steps
         */
        getAllStepHistory: () => {
            return Object.keys(stepDurationHistory).map(name => ({
                name,
                samples: stepDurationHistory[name].samples,
                average: stepDurationHistory[name].samples.reduce((a,b) => a+b, 0) /
                         stepDurationHistory[name].samples.length
            }));
        },

        /**
         * Get history info for a specific step
         * @param {string} stepName - Name of the step
         * @returns {Object|null} History info or null if no history
         */
        getStepHistoryInfo: (stepName) => {
            if (!stepDurationHistory[stepName]) return null;

            return {
                historyAverage: stepDurationHistory[stepName].samples.reduce((a,b) => a+b, 0) /
                               stepDurationHistory[stepName].samples.length,
                samples: stepDurationHistory[stepName].samples.length
            };
        },

        /**
         * Clean up history data for this app or a specified app
         * @param {string} [appNameToClean] - Optional app name to clean (defaults to current app)
         * @returns {Object} Result with success status and message
         */
        cleanHistory: (appNameToClean) => {
            const nameToClean = appNameToClean || name;
            const fileToClean = nameToClean === name
                ? historyFilePath
                : path.join(os.tmpdir(), pkg.name, `${nameToClean}-history.json`);

            if (!fileToClean) {
                return {
                    success: false,
                    message: 'No history file path available'
                };
            }

            try {
                if (fs.existsSync(fileToClean)) {
                    fs.unlinkSync(fileToClean);
                    return {
                        success: true,
                        message: `Successfully deleted history file: ${fileToClean}`,
                        path: fileToClean
                    };
                } else {
                    return {
                        success: true,
                        message: `No history file found at: ${fileToClean}`,
                        path: fileToClean
                    };
                }
            } catch (error) {
                return {
                    success: false,
                    message: `Error deleting history file: ${error.message}`,
                    error,
                    path: fileToClean
                };
            }
        },

        /**
         * Get the base directory for history files
         * @returns {string} Directory path
         */
        getHistoryDirectory: () => {
            return path.join(os.tmpdir(), pkg.name);
        }
    };
}

module.exports = createHistoryManager;
