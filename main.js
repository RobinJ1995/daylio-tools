#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');

const DAYLIO_PREDEFINED_MOOD_NAMES = {
    1: 'rad',
    2: 'good',
    3: 'meh',
    4: 'bad',
    5: 'awful'
};
const DAYLIO_MOOD_GROUP_VALUES = {
    1: 5,
    2: 4,
    3: 3,
    4: 2,
    5: 1,
}

const getDataFromDaylioArchive = async (archivePath) => {
    const backupArchiveFile = path.resolve(process.cwd(), archivePath);
    console.log(`Reading file: ${backupArchiveFile}`)

    const dir = await unzipper.Open.file(backupArchiveFile);
    const entry = dir.files.find(f => /(^|\/)backup\.daylio$/.test(f.path));
    if (!entry) throw new Error('Could not find "backup.daylio" inside the archive.');

    const base64 = (await entry.buffer()).toString('utf8');
    const json = Buffer.from(base64, 'base64').toString('utf8');

    return JSON.parse(json);
}

const getTagGroups = data => data.tag_groups.map(({ id, name, order, id_color }) => ({ id, name, order, id_color }));
const getTags = data => data.tags.map(({ id, name, order, state, id_tag_group, id_color }) => ({ id, name, order, state, id_tag_group, id_color }));
const getTagsWithGroupsPopulated = data => {
    const tagGroups = getTagGroups(data);
    const tags = getTags(data);

    return tags.map(tag => ({
        ...tag,
        group: tagGroups.find(tg => tg.id === tag.id_tag_group),
    }));
}
const getDatestamp = ({ year, month, day }) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const getEntries = data => data.dayEntries.map(({ id, minute, hour, day, month, year, datetime, mood, note, note_title, tags }) => ({ id, minute, hour, day, month, year, datetime, mood, note, note_title, tag_ids: tags, mood_id: mood, datestamp: getDatestamp({ year, month, day }) }));
const getEntriesPopulated = data => {
    const tags = getTagsWithGroupsPopulated(data);
    const moods = getMoods(data);
    const entries = getEntries(data);

    return entries.map(entry => ({
        ...entry,
        mood: moods.find(mood => mood.id === entry.mood_id),
        tags: entry.tag_ids.map(tagId => tags.find(tag => tag.id === tagId))
    }));
}
const getMoods = data => data.customMoods.map(({ id, custom_name, mood_group_id, predefined_name_id, state }) => ({
    id,
    name: custom_name || DAYLIO_PREDEFINED_MOOD_NAMES?.[predefined_name_id],
    value: DAYLIO_MOOD_GROUP_VALUES?.[mood_group_id],
}));
const getDays = data => {
    const allEntries = getEntriesPopulated(data);
    const datestamps = [...new Set(allEntries.map(({ datestamp }) => datestamp))].sort();

    return datestamps.map(datestamp => {
        const entries = allEntries.filter(entry => entry.datestamp === datestamp);
        const moodAverage = entries.reduce((acc, entry) => acc + entry.mood.value, 0) / entries.length;

        return {
            datestamp,
            entries,
            moodAverage,
        }
    });
}

(async () => {
    const arg = process.argv[2];
    if (!arg || arg === '-h' || arg === '--help') {
        console.error('Usage: node main.js <path-to-zip-archive>');
        process.exit(1);
    }

    const data = await getDataFromDaylioArchive(arg);

    const days = getDays(data);

    console.log(days);
})();
