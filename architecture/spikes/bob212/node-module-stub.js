export const createRequire = () => (id) => { throw new Error("require " + id + " in browser"); };
