// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// IOT/ is the Home Assistant platform, a separate Python project: keep Metro from crawling it.
const iotDir = path.join(__dirname, 'IOT').replace(/[/\\^$.*+?()[\]{}|]/g, '\\$&');
const blockIot = new RegExp(`^${iotDir}[/\\\\].*`);
const blockList = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(blockList) ? blockList : blockList ? [blockList] : []), blockIot];

module.exports = config;
