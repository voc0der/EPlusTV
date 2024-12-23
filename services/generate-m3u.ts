import _ from 'lodash';

import {NUM_OF_CHANNELS, START_CHANNEL, CHANNELS, LINEAR_START_CHANNEL} from './channels';

export const generateM3u = async (uri: string, linear = false): Promise<string> => {
  let m3uFile = '#EXTM3U';

  if (linear) {
    for (const key in CHANNELS.MAP) {
      const val = CHANNELS.MAP[key];

      if (val.checkChannelEnabled) {
        const enabled = await val.checkChannelEnabled();

        if (!enabled) {
          continue;
        }
      } else if (!val.canUse) {
        continue;
      }

      const channelNum = parseInt(key, 10) + LINEAR_START_CHANNEL;
      m3uFile = `${m3uFile}\n#EXTINF:0 tvg-id="${channelNum}.eplustv" channel-id="${val.name}" channel-number="${channelNum}" tvg-chno="${channelNum}" tvg-name="${val.tvgName}" tvc-guide-stationid="${val.stationId}" group-title="EPlusTV", ${val.name}`;
      m3uFile = `${m3uFile}\n${uri}/channels/${channelNum}.m3u8\n`;
    }
  } else {
    _.times(NUM_OF_CHANNELS, i => {
      const channelNum = START_CHANNEL + i;
      m3uFile = `${m3uFile}\n#EXTINF:0 tvg-id="${channelNum}.eplustv" channel-number="${channelNum}" tvg-chno="${channelNum}" tvg-name="EPlusTV ${channelNum}" group-title="EPlusTV", EPlusTV ${channelNum}`;
      m3uFile = `${m3uFile}\n${uri}/channels/${channelNum}.m3u8\n`;
    });
  }

  return m3uFile;
};
