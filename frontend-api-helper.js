// Frontend API utility - place this in your React app's utils folder
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// Configure fetch to always include credentials (cookies)
const apiRequest = async (endpoint, options = {}) => {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
    
    const config = {
        ...options,
        credentials: 'include', // This is crucial for sending cookies
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    };

    try {
        const response = await fetch(url, config);
        return response;
    } catch (error) {
        console.error('API request failed:', error);
        throw error;
    }
};

// Helper functions for common API calls
export const api = {
    // Check if user is authenticated
    checkAuth: () => apiRequest('/auth/user'),
    
    // Login (redirect to Discord OAuth)
    login: () => {
        window.location.href = `${API_BASE_URL}/auth/discord`;
    },
    
    // Logout
    logout: () => apiRequest('/auth/logout', { method: 'POST' }),
    
    // Upload video
    uploadVideo: (formData) => apiRequest('/upload', {
        method: 'POST',
        body: formData,
        headers: {} // Don't set Content-Type for FormData
    }),
      // Get clips
    getClips: () => apiRequest('/api/clips'),
};

export default api;
