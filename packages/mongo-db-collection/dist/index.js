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
export {
  createMongoDoCollection,
  isMongoDoCollectionConfig,
  mongoDoCollectionOptions
};
//# sourceMappingURL=index.js.map