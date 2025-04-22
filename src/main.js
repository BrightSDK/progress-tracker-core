// LICENSE_CODE ZON
'use strict';
const createHistoryManager = require('./history');

/**
 * Creates a simplified progress tracker with history management
 * @param {Object} options - Configuration options
 * @param {string} [options.name] - Optional name for the tracker
 * @param {boolean} [options.debug] - Enable debug output
 * @returns {Object} - Progress tracker instance
 */
function createProgressTrackerCore(options = {}) {
    const { name = 'default', debug = false } = options;

    // Create history manager for persistent storage of step durations
    const historyManager = createHistoryManager({ name, debug });

    let startTime = 0;
    let currentStep = null;
    let currentProgress = 0;
    let completedSteps = [];
    let stepConfigs = [];

    // Format seconds into mm:ss format
    const formatTimeDisplay = (seconds) => {
        if (!seconds && seconds !== 0 || isNaN(seconds) || !isFinite(seconds)) {
            return '';
        }

        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Calculate ETA based on progress and elapsed time
    const calculateETA = () => {
        const now = Date.now();
        const elapsedMs = now - startTime;

        // No ETA if no progress or just started
        if (currentProgress <= 0 || elapsedMs <= 0) {
            return null;
        }

        // If we have completed steps, use their data for more accurate ETA
        if (completedSteps.length > 0) {
            // Calculate a time-per-percentage rate from completed steps
            const totalPercentCovered = completedSteps.reduce((sum, step) => {
                return sum + (step.endPercentage - step.startPercentage);
            }, 0);

            const totalTimeSpent = completedSteps.reduce((sum, step) => {
                return sum + step.actualDuration;
            }, 0);

            if (totalPercentCovered > 0 && totalTimeSpent > 0) {
                const timePerPercent = totalTimeSpent / totalPercentCovered;
                const remainingPercentage = 100 - currentProgress;
                return Math.round(timePerPercent * remainingPercentage);
            }
        }

        // Fall back to simple calculation based on current progress
        const msPerPercent = elapsedMs / currentProgress;
        const remainingPercentage = 100 - currentProgress;
        return Math.round((msPerPercent * remainingPercentage) / 1000);
    };

    // Get or create step configuration
    const getStepConfig = (step) => {
        if (!step || !step.name || step.endPercentage === undefined) {
            if (debug) console.warn('Invalid step configuration:', step);
            return null;
        }

        // Find the last step to determine default starting percentage
        const lastStep = stepConfigs.length > 0 ?
            stepConfigs[stepConfigs.length - 1] : null;

        // Set start percentage based on last step or default to 0
        const startPercentage = step.startPercentage !== undefined ?
            step.startPercentage :
            (lastStep ? lastStep.endPercentage : 0);

        // Check history for this step
        const hasHistory = historyManager.hasHistoryForStep(step.name);

        // Determine step duration
        let duration;
        if (hasHistory) {
            // Use historical duration data
            duration = historyManager.getEstimatedDuration(step.name, step.duration || 10);
            if (debug) console.log(`[${name}] Using historical duration for "${step.name}": ${duration}s`);
        } else {
            // Use provided duration or default based on percentage range
            duration = step.duration || Math.max(5, (step.endPercentage - startPercentage));
            if (debug) console.log(`[${name}] Using default duration for "${step.name}": ${duration}s`);
        }

        // Create and store the step configuration
        const newConfig = {
            name: step.name,
            label: step.label || step.name,
            startPercentage,
            endPercentage: step.endPercentage,
            duration,
            originalDuration: step.duration, // Store original for history updates
            hasHistoryData: hasHistory
        };

        stepConfigs.push(newConfig);
        return newConfig;
    };

    return {
        /**
         * Start or reset the progress tracker
         * @returns {Object} Initial progress data
         */
        start: () => {
            startTime = Date.now();
            currentProgress = 0;
            currentStep = null;
            completedSteps = [];
            stepConfigs = [];

            if (debug) console.log(`[${name}] Starting progress tracker`);

            return {
                progress: 0,
                status: 'Starting...',
                etaSeconds: null,
                etaString: ''
            };
        },

        /**
         * Update the current step
         * @param {Object} step - Step configuration
         * @param {string} step.name - Step name
         * @param {string} [step.label] - Human-readable label
         * @param {number} step.endPercentage - Maximum percentage this step can reach
         * @param {number} [step.duration] - Expected duration in seconds
         * @returns {Object} Updated progress data
         */
        updateStep: (step) => {
            const now = Date.now();

            // Complete the previous step if it exists
            if (currentStep) {
                const actualDuration = (now - currentStep.startTime) / 1000;
                const stepConfig = stepConfigs.find(s => s.name === currentStep.name);

                if (stepConfig) {
                    // Record completed step data
                    const prev = completedSteps[completedSteps.length - 1] || {};
                    const completedStep = {
                        name: currentStep.name,
                        startPercentage: prev.endPercentage || 0,
                        endPercentage: stepConfig.endPercentage,
                        estimatedDuration: stepConfig.duration,
                        actualDuration
                    };

                    completedSteps.push(completedStep);

                    // Update history with actual duration
                    historyManager.updateStepDuration(
                        currentStep.name,
                        stepConfig.originalDuration || stepConfig.duration,
                        actualDuration
                    );

                    if (debug) {
                        console.log(`[${name}] Completed step "${currentStep.name}" in ${actualDuration.toFixed(2)}s`);
                    }
                }
            }

            // Get step configuration
            const stepConfig = getStepConfig(step);
            if (!stepConfig) {
                return {
                    progress: currentProgress,
                    status: currentStep?.label || 'In progress...',
                    etaSeconds: calculateETA(),
                    etaString: formatTimeDisplay(calculateETA())
                };
            }

            // Set new current step
            currentStep = {
                name: step.name,
                label: stepConfig.label,
                startTime: now,
                startPercentage: stepConfig.startPercentage,
                endPercentage: stepConfig.endPercentage
            };

            // Update progress to match the start of this step
            currentProgress = stepConfig.startPercentage;

            if (debug) {
                console.log(`[${name}] Starting step "${currentStep.name}" (${stepConfig.startPercentage}% to ${stepConfig.endPercentage}%)`);
            }

            return {
                progress: currentProgress,
                status: currentStep.label,
                etaSeconds: calculateETA(),
                etaString: formatTimeDisplay(calculateETA())
            };
        },

        /**
         * Get the current progress
         * @returns {Object} Current progress data
         */
        getProgress: () => {
            if (!currentStep) {
                return {
                    progress: currentProgress,
                    status: 'In progress...',
                    etaSeconds: null,
                    etaString: ''
                };
            }

            const now = Date.now();
            const stepConfig = stepConfigs.find(s => s.name === currentStep.name);

            if (!stepConfig) {
                return {
                    progress: currentProgress,
                    status: currentStep.label || 'In progress...',
                    etaSeconds: calculateETA(),
                    etaString: formatTimeDisplay(calculateETA())
                };
            }

            // Calculate progress within this step
            const elapsedInStep = (now - currentStep.startTime) / 1000;
            const progressRatio = Math.min(elapsedInStep / stepConfig.duration, 0.99);
            const percentageRange = stepConfig.endPercentage - stepConfig.startPercentage;
            const calculatedProgress = stepConfig.startPercentage + (percentageRange * progressRatio);

            // Update current progress if calculated is greater
            if (calculatedProgress > currentProgress) {
                currentProgress = Math.min(calculatedProgress, stepConfig.endPercentage);
            }

            // Calculate ETA
            const etaSeconds = calculateETA();
            const etaString = formatTimeDisplay(etaSeconds);

            return {
                progress: currentProgress,
                status: currentStep.label,
                etaSeconds,
                etaString,
                hasHistoryData: stepConfig.hasHistoryData
            };
        },
        /**
         * Finish the progress tracking and mark as complete
         * @param {Object} [options] - Options for finishing
         * @param {string} [options.status='Completed'] - Final status message
         * @returns {Object} Final progress data
         */
        finish: (options = {}) => {
            const now = Date.now();
            const status = options.status || 'Completed';

            // Complete the current step if one exists
            if (currentStep) {
                const actualDuration = (now - currentStep.startTime) / 1000;
                const stepConfig = stepConfigs.find(s => s.name === currentStep.name);

                if (stepConfig) {
                    // Record completed step data
                    const completedStep = {
                        name: currentStep.name,
                        startPercentage: stepConfig.startPercentage,
                        endPercentage: stepConfig.endPercentage,
                        estimatedDuration: stepConfig.duration,
                        actualDuration
                    };

                    completedSteps.push(completedStep);

                    // Update history with actual duration
                    historyManager.updateStepDuration(
                        currentStep.name,
                        stepConfig.originalDuration || stepConfig.duration,
                        actualDuration
                    );

                    if (debug) {
                        console.log(`[${name}] Completed step "${currentStep.name}" in ${actualDuration.toFixed(2)}s`);
                    }
                }
            }

            // Set to 100% progress
            currentProgress = 100;

            // Calculate total elapsed time
            const totalElapsedSeconds = (now - startTime) / 1000;

            if (debug) {
                console.log(`[${name}] Process finished in ${totalElapsedSeconds.toFixed(2)}s`);
            }

            // Reset the runSessionId in the history manager to ensure next run creates new samples
            // This is the key change needed to ensure samples accumulate across runs
            try {
                // Since we don't have direct access to reset the runSessionId in historyManager,
                // we can call cleanSession or create a new method if needed
                if (typeof historyManager.resetSession === 'function') {
                    historyManager.resetSession();
                }
            } catch (err) {
                if (debug) {
                    console.error(`[${name}] Error resetting session:`, err.message);
                }
            }

            return {
                progress: 100,
                status,
                etaSeconds: 0,
                etaString: ''
            };
        },
        /**
         * Get a summary of all steps completed
         * @returns {Object} Summary information
         */
        summary: () => {
            const totalTime = completedSteps.reduce((sum, step) => sum + step.actualDuration, 0);

            return {
                totalTime,
                steps: completedSteps,
                historyFilePath: historyManager.getHistoryFilePath()
            };
        },

        /**
         * Clean history data
         * @param {string} [appName] - Optional app name to clean (defaults to current app)
         * @returns {Object} Result with success status
         */
        cleanHistory: (appName) => {
            return historyManager.cleanHistory(appName);
        },

        /**
         * Get information about history storage
         * @returns {Object} History storage information
         */
        getHistoryInfo: () => {
            return {
                directory: historyManager.getHistoryDirectory(),
                currentAppHistoryPath: historyManager.getHistoryFilePath(),
                currentAppName: name
            };
        }
    };
}

module.exports = createProgressTrackerCore;