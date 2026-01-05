"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  createMongoDoCollection: () => createMongoDoCollection,
  isMongoDoCollectionConfig: () => isMongoDoCollectionConfig,
  mongoDoCollectionOptions: () => mongoDoCollectionOptions
});
module.exports = __toCommonJS(index_exports);

// src/types/index.ts
function isMongoDoCollectionConfig(value) {
  if (!value || typeof value !== "object") return false;
  const config = value;
  return typeof config.id === "string" && typeof config.endpoint === "string" && typeof config.database === "string" && typeof config.collectionName === "string" && typeof config.schema === "object" && typeof config.getKey === "function";
}

// src/index.ts
function mongoDoCollectionOptions(config) {
  return config;
}
function createMongoDoCollection(config) {
  return mongoDoCollectionOptions(config);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createMongoDoCollection,
  isMongoDoCollectionConfig,
  mongoDoCollectionOptions
});
//# sourceMappingURL=index.cjs.map