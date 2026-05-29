# progress-tracker-core

> Core utility for tracking progress of multi-step operations with estimated durations and history-based ETA.

[![Lint](https://github.com/BrightSDK/progress-tracker-core/actions/workflows/lint.yml/badge.svg)](https://github.com/BrightSDK/progress-tracker-core/actions/workflows/lint.yml)
[![Test](https://github.com/BrightSDK/progress-tracker-core/actions/workflows/test.yml/badge.svg)](https://github.com/BrightSDK/progress-tracker-core/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

## Installation

```bash
npm install github:BrightSDK/progress-tracker-core
```

## Usage

```js
const createProgressTracker = require('brd-ono-util-progress-tracker-core');

const tracker = createProgressTracker({ name: 'my-app' });

tracker.start();

tracker.updateStep({ name: 'download', endPercentage: 50 });
// ... do work ...

tracker.updateStep({ name: 'extract', endPercentage: 100 });
// ... do work ...

tracker.finish();
console.log(tracker.summary());
```

## Features

- Step-based progress tracking with percentage allocation
- History-based ETA estimation (learns from previous runs)
- Persistent duration history in system temp directory
- Zero production dependencies

## API

### `createProgressTracker(options)`

| Option  | Type    | Default     | Description                                            |
| ------- | ------- | ----------- | ------------------------------------------------------ |
| `name`  | string  | `'default'` | Name for history file (alphanumeric, dash, underscore) |
| `debug` | boolean | `false`     | Enable debug output                                    |

### Methods

| Method                                 | Description                           |
| -------------------------------------- | ------------------------------------- |
| `.start()`                             | Start/reset the tracker               |
| `.updateStep({ name, endPercentage })` | Advance to the next step              |
| `.getProgress()`                       | Get current progress, status, and ETA |
| `.finish()`                            | Mark as complete (100%)               |
| `.summary()`                           | Get timing summary of all steps       |
| `.cleanHistory()`                      | Delete history file for this app      |

## License

[MIT](LICENSE)
