// LICENSE_CODE ZON
'use strict';
const createHistoryManager = require('./history');

/**
 * Creates a progress tracker core
 * @param {Object} options - Configuration options
 * @param {number} [options.updateInterval=100] - Update interval in milliseconds
 * @param {string} [options.name] - Optional name to store duration history across runs
 * @param {boolean} [options.debug] - Enable debug output for history loading and detailed summaries
 * @returns {Object} - Progress tracker core instance
 */
function createProgressTrackerCore(options = {}) {
    const {
        updateInterval = 100,
        name = 'app',
        debug = false,
    } = options;

    // Create the history manager
    const historyManager = createHistoryManager({ name, debug });
    const historyFilePath = historyManager.getHistoryFilePath();

    const checkpoints = [];
    const stepConfigs = [];
    const completedSteps = []; // Store completed step data for duration analysis

    // Track current progress
    let currentProgress = 0;
    let durationAdjustmentFactor = 1.0; // Initial adjustment factor is neutral
    let startTime = 0;
    let currentStep = null;
    let targetPercentage = 0;
    let transitionStart = 0;
    let inTransition = false;
    const transitionDuration = 500; // ms for smooth transition

    // Format seconds into mm:ss format for display
    const formatTimeDisplay = (seconds) => {
        if (!seconds && seconds !== 0) return '';
        if (seconds === 0) return '00:00';

        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;

        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Calculate estimated time remaining based on progress and elapsed time
    const calculateETA = () => {
        const now = Date.now();

        if (currentProgress <= 0) return null;
        if (currentProgress >= 100) return 0; // Finished

        const elapsedMs = now - startTime;
        if (elapsedMs <= 0) return null;

        // If we have completed at least one step, we can provide a more accurate ETA
        if (completedSteps.length > 0) {
            // Get the first completed step for reference
            const firstStep = completedSteps[0];
            const stepConfig = stepConfigs.find(s => s.name === firstStep.name);

            if (stepConfig) {
                const percentCovered = stepConfig.endPercentage - (stepConfig.startPercentage || 0);
                const timePerPercent = firstStep.actualDuration / percentCovered;
                const remainingPercentage = 100 - currentProgress;
                return Math.round(remainingPercentage * timePerPercent);
            }
        }

        // Fall back to simple calculation if no completed steps
        const remainingPercentage = 100 - currentProgress;
        const msPerPercent = elapsedMs / currentProgress;
        const estimatedRemainingSeconds = Math.round((msPerPercent * remainingPercentage) / 1000);

        return estimatedRemainingSeconds;
    };

    // Helper function to recalculate duration adjustment factor
    const recalculateDurationAdjustmentFactor = () => {
        if (completedSteps.length < 1) return; // Need at least one completed step

        // Calculate average ratio of estimated to actual durations
        const ratioSum = completedSteps.reduce((sum, step) => {
            return sum + (step.estimatedDuration / step.actualDuration);
        }, 0);

        // Update the adjustment factor (average ratio)
        durationAdjustmentFactor = ratioSum / completedSteps.length;

        // Limit adjustment factor to reasonable bounds (0.1 to 10)
        durationAdjustmentFactor = Math.max(0.1, Math.min(10, durationAdjustmentFactor));
    };

    // Calculate total estimated duration based on step configs
    const calculateEstimatedTotalDuration = () => {
        if (stepConfigs.length === 0) return 0;

        // Sum up durations and apply the adjustment factor
        return stepConfigs.reduce((sum, step) => {
            return sum + (step.duration * durationAdjustmentFactor);
        }, 0);
    };

    // Handle step configuration
    function getStepConfig(step) {
        // Only accept step objects with proper configuration
        if (!step || typeof step !== 'object' || !step.name) {
            console.warn('Warning: Invalid step configuration. Must be an object with a name property.');
            return null;
        }

        // Check if we already have this step
        const existingConfig = stepConfigs.find(s => s.name === step.name);
        if (existingConfig) {
            return existingConfig;
        }

        // Require at least name and endPercentage
        if (step.endPercentage !== undefined) {
            const lastStep = stepConfigs.length > 0 ?
                stepConfigs[stepConfigs.length - 1] : null;

            // Check if we have history for this step
            const hasHistory = historyManager.hasHistoryForStep(step.name);
            let duration;

            if (hasHistory) {
                // Use history to estimate duration
                duration = historyManager.getEstimatedDuration(
                    step.name,
                    step.duration || Math.max((step.endPercentage - (step.startPercentage || 0)), 5)
                );
            } else if (step.duration !== undefined) {
                // Use provided duration as fallback if no history
                duration = step.duration;
                if (debug) {
                    console.log(`No history for step "${step.name}", using provided duration: ${duration.toFixed(1)}s`);
                }
            } else {
                // No history and no provided duration, use a calculated default
                // Based on percentage range and assuming 1% takes about 1 second
                const startPercentage = step.startPercentage !== undefined ?
                    step.startPercentage : (lastStep ? lastStep.endPercentage : 0);
                const percentRange = step.endPercentage - startPercentage;
                duration = Math.max(percentRange, 5); // At least 5 seconds
                if (debug) {
                    console.log(`No history or duration for step "${step.name}", using calculated default: ${duration.toFixed(1)}s`);
                }
            }

            const newConfig = {
                name: step.name,
                duration: duration,
                originalDuration: step.duration, // May be undefined
                startPercentage: step.startPercentage !== undefined ?
                    step.startPercentage : (lastStep ? lastStep.endPercentage : 0),
                endPercentage: step.endPercentage,
                label: step.label,
                hasHistoryData: hasHistory
            };

            stepConfigs.push(newConfig);
            return newConfig;
        } else {
            console.warn(`Warning: Step "${step.name}" has incomplete configuration. Progress may not display correctly.`);
            return null;
        }
    }

    const core = {
        start: () => {
            startTime = Date.now();
            currentProgress = 0;

            const data = {
                startTime,
                progress: currentProgress,
                status: 'Starting...',
                etaSeconds: null,
                etaString: ''
            };
            return data;
        },

        updateStep: (step) => {
            const timestamp = Date.now();

            // If there's a current step, record its completion
            if (currentStep) {
                const completedStepConfig = stepConfigs.find(s => s.name === currentStep.name);
                if (completedStepConfig) {
                    const actualDuration = (timestamp - currentStep.startTime) / 1000;
                    completedSteps.push({
                        name: currentStep.name,
                        estimatedDuration: completedStepConfig.duration,
                        actualDuration: actualDuration
                    });

                    // Always update step duration history with actual duration
                    const originalDuration = completedStepConfig.originalDuration !== undefined ?
                        completedStepConfig.originalDuration : completedStepConfig.duration;

                    historyManager.updateStepDuration(
                        currentStep.name,
                        originalDuration,
                        actualDuration
                    );

                    // Recalculate the adjustment factor based on completed steps
                    recalculateDurationAdjustmentFactor();
                }
            }

            if (!step || typeof step !== 'object' || !step.name) {
                console.warn('Warning: Invalid step provided to updateStep. Must be an object with a name property.');
                return { timestamp, progress: currentProgress };
            }

            const stepConfig = getStepConfig(step);
            if (!stepConfig) return { timestamp, progress: currentProgress };

            checkpoints.push({ name: step.name, timestamp });

            // Recalculate total estimated duration when steps change
            const estimatedTotalDuration = calculateEstimatedTotalDuration();

            // Set up new step info
            currentStep = {
                name: step.name,
                startTime: timestamp,
                label: stepConfig.label
            };

            // Update progress to step's starting percentage
            const previousProgress = currentProgress;
            currentProgress = stepConfig.startPercentage;

            return {
                timestamp,
                progress: currentProgress,
                previousProgress,
                targetProgress: stepConfig.endPercentage,
                stepConfig,
                status: stepConfig.label || step.name,
                etaSeconds: null,
                etaString: '',
                inTransition: true,
            };
        },

        completeStep: (stepName) => {
            const stepConfig = stepConfigs.find(s => s.name === stepName);
            if (!stepConfig) return { progress: currentProgress };

            // Record completion time of the step if it's the current step
            if (currentStep && currentStep.name === stepName) {
                const actualDuration = (Date.now() - currentStep.startTime) / 1000;

                // Add to completedSteps, ensuring we have proper metadata
                completedSteps.push({
                    name: stepName,
                    estimatedDuration: stepConfig.duration,
                    actualDuration: actualDuration,
                    startPercentage: stepConfig.startPercentage || 0,
                    endPercentage: stepConfig.endPercentage
                });

                // Safely get original duration, falling back to the regular duration
                const originalDuration = stepConfig.originalDuration !== undefined ?
                    stepConfig.originalDuration : stepConfig.duration;

                // Update step duration history
                historyManager.updateStepDuration(
                    stepName,
                    originalDuration,
                    actualDuration
                );

                // Recalculate the adjustment factor
                recalculateDurationAdjustmentFactor();
            }

            // Use the step's configured end percentage
            const previousProgress = currentProgress;
            const finalPercentage = stepConfig.endPercentage;
            currentProgress = finalPercentage;

            const status = `Completed: ${stepConfig.label ? stepConfig.label.replace(/\.\.\..*$/, '').replace(/ \(\d+\/\d+\)/, '') : stepName}`;

            return {
                progress: finalPercentage,
                previousProgress,
                status,
                etaSeconds: 0,
                etaString: '',
                inTransition: true
            };
        },

        getProgress: () => {
            if (!currentStep) {
                return {
                    progress: currentProgress,
                    status: 'In progress...',
                    etaSeconds: null,
                    etaString: '',
                    hasHistoryData: false
                };
            }

            const now = Date.now();
            const elapsedSinceStepStart = (now - currentStep.startTime) / 1000;

            // Find step config
            const stepConfig = stepConfigs.find(s => s.name === currentStep.name);
            if (!stepConfig) {
                return {
                    progress: currentProgress,
                    status: currentStep.name,
                    etaSeconds: null,
                    etaString: '',
                    hasHistoryData: false
                };
            }

            // Apply the duration adjustment factor to get a more accurate duration estimate
            const adjustedDuration = stepConfig.duration * durationAdjustmentFactor;

            // Use adjusted duration to calculate progress
            const progress = Math.min(elapsedSinceStepStart / adjustedDuration, 0.99);
            const progressRange = stepConfig.endPercentage - stepConfig.startPercentage;
            const calculatedPercentage = Math.round(stepConfig.startPercentage + (progressRange * progress));

            // Update current progress if calculated is greater
            if (calculatedPercentage > currentProgress && calculatedPercentage <= stepConfig.endPercentage) {
                currentProgress = calculatedPercentage;
            }

            // Calculate ETA if we have history data OR at least one completed step
            let etaSeconds = null;
            let etaString = '';
            if (stepConfig.hasHistoryData || completedSteps.length > 0) {
                etaSeconds = calculateETA();
                etaString = etaSeconds !== null ? formatTimeDisplay(etaSeconds) : '';
            }

            return {
                progress: currentProgress,
                status: stepConfig.label || currentStep.name,
                etaSeconds,
                etaString,
                hasHistoryData: stepConfig.hasHistoryData || completedSteps.length > 0,
            };
        },

        summary: () => {
            if (checkpoints.length < 2) return { totalTime: 0, steps: [] };

            const start = checkpoints[0].timestamp;
            const end = checkpoints[checkpoints.length - 1].timestamp;
            const totalTime = (end - start) / 1000;

            const steps = [];
            for (let i = 1; i < checkpoints.length; i++) {
                const prev = checkpoints[i-1];
                const curr = checkpoints[i];
                const duration = (curr.timestamp - prev.timestamp) / 1000;
                steps.push({
                    from: prev.name,
                    to: curr.name,
                    duration
                });
            }

            // Create analysis data, ensuring each step is only analyzed once
            const analyzedSteps = new Set();
            const analysis = completedSteps
                .filter(step => {
                    // Only include each step name once in the analysis
                    if (analyzedSteps.has(step.name)) {
                        return false;
                    }
                    analyzedSteps.add(step.name);
                    return true;
                })
                .map(step => {
                    const stepConfig = stepConfigs.find(s => s.name === step.name);
                    const configuredDuration = stepConfig ? stepConfig.originalDuration : null;
                    const historyInfo = historyManager.getStepHistoryInfo(step.name);

                    return {
                        name: step.name,
                        configuredDuration,
                        estimatedDuration: step.estimatedDuration,
                        actualDuration: step.actualDuration,
                        ratio: step.estimatedDuration / step.actualDuration,
                        historyInfo
                    };
                });

            return {
                totalTime,
                steps,
                adjustmentFactor: durationAdjustmentFactor,
                analysis,
                historyFilePath
            };
        },

        /**
         * Clean history data for this app or a specified app
         * @param {string} [appName] - Optional app name to clean (defaults to current app)
         * @returns {Object} Result with success status and message
         */
        cleanHistory: (appName) => {
            return historyManager.cleanHistory(appName);
        },

        dumpHistory: () => {
            return {
                steps: historyManager.getAllStepHistory(),
                path: historyFilePath
            };
        },

        getFormatTimeDisplay: () => formatTimeDisplay,

        /**
         * Get information about where history is stored
         * @returns {Object} History storage information
         */
        getHistoryInfo: () => {
            return {
                directory: historyManager.getHistoryDirectory(),
                currentAppHistoryPath: historyFilePath,
                currentAppName: name
            };
        },
    };

    return core;
}

module.exports = createProgressTrackerCore;
