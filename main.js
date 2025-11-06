#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');

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
        group: tagGroups.find(tg => tg.id === tag.id_tag_group)
    }));
}
const getEntries = data => data.dayEntries.map(({ id, minute, hour, day, month, year, datetime, mood, note, note_title, tags }) => ({ id, minute, hour, day, month, year, datetime, mood, note, note_title, tags }));
const getEntriesPopulated = data => {
    const tags = getTagsWithGroupsPopulated(data);
    const entries = getEntries(data);

    return entries.map(entry => ({
        ...entry,
        tag_ids: entry.tags,
        tags: entry.tags.map(tagId => tags.find(tag => tag.id === tagId))
    }));
}

(async () => {
    const arg = process.argv[2];
    if (!arg || arg === '-h' || arg === '--help') {
        console.error('Usage: node main.js <path-to-zip-archive>');
        process.exit(1);
    }

    const data = await getDataFromDaylioArchive(arg);

    const entries = getEntriesPopulated(data);

    console.log(entries);
})();
