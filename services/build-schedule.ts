import {db, IDocument} from './database';
import {getNumberOfChannels, getStartChannel, usesLinear} from './misc-db-service';
import {IChannel, IEntry} from './shared-interfaces';

export const removeEntriesProvider = async (providerName: string): Promise<void> => {
  await db.entries.removeAsync({from: providerName}, {multi: true});
};

const scheduleEntry = async (entry: IEntry & IDocument, startChannel: number, numOfChannels: number): Promise<void> => {
  let channelNum: number;

  const availableChannels = await db.schedule
    .findAsync<IChannel & IDocument>({channel: {$gte: startChannel}, endsAt: {$lt: entry.start}})
    .sort({channel: 1});

  if (!availableChannels || !availableChannels.length) {
    const channelNums = await db.schedule.countAsync({});

    if (channelNums > numOfChannels - 1) {
      return;
    }

    channelNum = channelNums + startChannel;

    await db.schedule.insertAsync<IChannel>({
      channel: channelNum,
      endsAt: entry.end,
    });
  } else {
    channelNum = +availableChannels[0].channel;

    await db.schedule.updateAsync<IChannel & IDocument, any>(
      {_id: availableChannels[0]._id},
      {$set: {endsAt: entry.end}},
    );
  }

  await db.entries.updateAsync<IEntry, any>({_id: entry._id}, {$set: {channel: channelNum}});
};

export const scheduleEntries = async (): Promise<void> => {
  let needReschedule = false;

  const useLinear = await usesLinear();
  const startChannel = await getStartChannel();
  const numOfChannels = await getNumberOfChannels();

  if (!useLinear) {
    const linearEntries = await db.entries.countAsync({linear: {$exists: true}});

    if (linearEntries > 0) {
      needReschedule = true;
    }
  }

  if (needReschedule) {
    console.log('');
    console.log('====================================================================');
    console.log('===                                                              ===');
    console.log('===   Need to rebuild the schedule because the linear channels   ===');
    console.log('===            variable is no longer being used.                 ===');
    console.log('===                                                              ===');
    console.log('====================================================================');
    console.log('===  THIS WILL BREAK SCHEDULED RECORDINGS IN YOUR DVR SOFTWARE   ===');
    console.log('====================================================================');
    console.log('');

    // Remove schedule
    await db.schedule.removeAsync({}, {multi: true});

    // Remove all dedicated linear channel entries
    await db.entries.removeAsync(
      {$or: [{channel: 'cbssportshq'}, {channel: 'golazo'}, {channel: 'NFLNETWORK'}, {channel: 'NFLDIGITAL1_OO_v3'}]},
      {multi: true},
    );

    // Remove channel and linear props from existing entries
    await db.entries.updateAsync<IEntry, any>({}, {$unset: {channel: true, linear: true}}, {multi: true});

    return await scheduleEntries();
  }

  const unscheduledEntries = await db.entries
    .findAsync<IEntry & IDocument>({channel: {$exists: false}})
    .sort({start: 1});

  unscheduledEntries.length > 0 && console.log(`Scheduling ${unscheduledEntries.length} entries...`);

  for (const entry of unscheduledEntries) {
    await scheduleEntry(entry, startChannel, numOfChannels);
  }
};
