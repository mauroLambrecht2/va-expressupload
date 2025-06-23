// In-memory stores (replace with actual database in production)
const videoStore = new Map();
const userStore = new Map();
const userUploads = new Map();

module.exports = {
    videoStore,
    userStore,
    userUploads
};
