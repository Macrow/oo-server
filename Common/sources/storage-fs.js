/*
 * (c) Copyright Ascensio System SIA 2010-2023
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

'use strict';

const { cp, rm, mkdir } = require('fs/promises');
const { stat, readFile, writeFile } = require('fs/promises');
var path = require('path');
var utils = require("./utils");
var crypto = require('crypto');
const ms = require('ms');
const commonDefines = require('./../../Common/sources/commondefines');
const constants = require('./../../Common/sources/constants');

var config = require('config');
var configStorage = config.get('storage');
var cfgBucketName = configStorage.get('bucketName');
var cfgStorageFolderName = configStorage.get('storageFolderName');
var configFs = configStorage.get('fs');
var cfgStorageFolderPath = configFs.get('folderPath');
var cfgStorageSecretString = configFs.get('secretString');
var cfgStorageUrlExpires = configFs.get('urlExpires');
const cfgExpSessionAbsolute = ms(config.get('services.CoAuthoring.expire.sessionabsolute'));

function getFilePath(strPath) {
  return path.join(cfgStorageFolderPath, strPath);
}
function getOutputPath(strPath) {
  return strPath.replace(/\\/g, '/');
}

async function headObject(strPath) {
  let fsPath = getFilePath(strPath);
  let stats = await stat(fsPath);
  return {ContentLength: stats.size};
}

async function getObject(strPath) {
  let fsPath = getFilePath(strPath);
  return await readFile(fsPath);
}

async function createReadStream(strPath) {
  let fsPath = getFilePath(strPath);
  let stats = await stat(fsPath);
  let contentLength = stats.size;
  let readStream = await utils.promiseCreateReadStream(fsPath);
  return {
    contentLength: contentLength,
    readStream: readStream
  };
}

async function putObject(strPath, buffer, contentLength) {
  var fsPath = getFilePath(strPath);
  await mkdir(path.dirname(fsPath), {recursive: true});

  if (Buffer.isBuffer(buffer)) {
    await writeFile(fsPath, buffer);
  } else {
    let writable = await utils.promiseCreateWriteStream(fsPath);
    await utils.pipeStreams(buffer, writable, true);
  }
}

async function uploadObject(strPath, filePath) {
  let fsPath = getFilePath(strPath);
  await cp(filePath, fsPath, {force: true, recursive: true});
}

async function copyObject(sourceKey, destinationKey) {
  let fsPathSource = getFilePath(sourceKey);
  let fsPathDestination = getFilePath(destinationKey);
  await cp(fsPathSource, fsPathDestination, {force: true, recursive: true});
}

async function listObjects(strPath) {
  let fsPath = getFilePath(strPath);
  let values = await utils.listObjects(fsPath);
  return values.map(function(curvalue) {
    return getOutputPath(curvalue.substring(cfgStorageFolderPath.length + 1));
  });
}

async function deleteObject(strPath) {
  const fsPath = getFilePath(strPath);
  return rm(fsPath, {force: true, recursive: true});
}

async function deletePath(strPath) {
  const fsPath = getFilePath(strPath);
  return rm(fsPath, {force: true, recursive: true});
}

async function getSignedUrl(ctx, baseUrl, strPath, urlType, optFilename, opt_creationDate) {
  //replace '/' with %2f before encodeURIComponent becase nginx determine %2f as '/' and get wrong system path
  var userFriendlyName = optFilename ? encodeURIComponent(optFilename.replace(/\//g, "%2f")) : path.basename(strPath);
  var uri = '/' + cfgBucketName + '/' + cfgStorageFolderName + '/' + strPath + '/' + userFriendlyName;
  //RFC 1123 does not allow underscores https://stackoverflow.com/questions/2180465/can-domain-name-subdomains-have-an-underscore-in-it
  var url = utils.checkBaseUrl(ctx, baseUrl).replace(/_/g, "%5f");
  url += uri;

  var date = Date.now();
  let creationDate = opt_creationDate || date;
  let expiredAfter = (commonDefines.c_oAscUrlTypes.Session === urlType ? (cfgExpSessionAbsolute / 1000) : cfgStorageUrlExpires) || 31536000;
  //todo creationDate can be greater because mysql CURRENT_TIMESTAMP uses local time, not UTC
  var expires = creationDate + Math.ceil(Math.abs(date - creationDate) / expiredAfter) * expiredAfter;
  expires = Math.ceil(expires / 1000);
  expires += expiredAfter;

  var md5 = crypto.createHash('md5').update(expires + decodeURIComponent(uri) + cfgStorageSecretString).digest("base64");
  md5 = md5.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  url += '?md5=' + encodeURIComponent(md5);
  url += '&expires=' + encodeURIComponent(expires);
  if (ctx.shardKey) {
    url += `&${constants.SHARED_KEY_NAME}=${encodeURIComponent(ctx.shardKey)}`;
  }
  url += '&filename=' + userFriendlyName;
  return url;
}

module.exports = {
  headObject,
  getObject,
  createReadStream,
  putObject,
  uploadObject,
  copyObject,
  listObjects,
  deleteObject,
  deletePath,
  getSignedUrl
};
