'use strict';

const VISION_MODEL = 'deepseek-v4-flash-vision-exp';
// One model for every endpoint and task, including upgraded saved settings.
function modelFor() { return VISION_MODEL; }
module.exports = { VISION_MODEL, modelFor };
