// Auth API Configuration
const API_BASE = '/api';

// DOM Elements
let currentPage = '';

// Utility Functions
function showMessage(message, type = 'info') {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = `<div class="message ${type}">${message}</div>`;

    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
        setTimeout(() => {
            messagesDiv.innerHTML = '';
        }, 5000);
    }
}

function clearMessages() {
    document.getElementById('messages').innerHTML = '';
}

function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.form-section').forEach(section => {
        section.classList.add('hidden');
    });

    // Show the specified section
    document.getElementById(sectionId).classList.remove('hidden');
}

function updateNavButtons(isLoggedIn = false) {
    const signupTab = document.getElementById('signup-tab');
    const loginTab = document.getElementById('login-tab');
    const profileLink = document.getElementById('profile-link');
    const logoutBtn = document.getElementById('logout-btn');

    if (isLoggedIn) {
        if (signupTab) signupTab.classList.add('hidden');
        if (loginTab) loginTab.classList.add('hidden');
        if (profileLink) profileLink.classList.remove('hidden');
        if (logoutBtn) logoutBtn.classList.remove('hidden');
    } else {
        if (signupTab) signupTab.classList.remove('hidden');
        if (loginTab) loginTab.classList.remove('hidden');
        if (profileLink) profileLink.classList.add('hidden');
        if (logoutBtn) logoutBtn.classList.add('hidden');
    }
}

function checkAuthStatus() {
    // Check if we have a session by making a request to /me
    return fetch(`${API_BASE}/me`, {
        method: 'GET',
        credentials: 'include'
    })
    .then(response => {
        if (response.ok) {
            return response.json();
        } else {
            throw new Error('Not authenticated');
        }
    })
    .then(data => {
        updateNavButtons(true);
        return data;
    })
    .catch(() => {
        updateNavButtons(false);
        return null;
    });
}

// API Functions
async function signup(username, password) {
    const response = await fetch(`${API_BASE}/signup`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Signup failed');
    }

    return response;
}

async function login(username, password) {
    const response = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Login failed');
    }

    return response.json();
}

async function logout() {
    const response = await fetch(`${API_BASE}/logout`, {
        method: 'POST',
        credentials: 'include',
    });

    if (!response.ok) {
        throw new Error('Logout failed');
    }

    return response;
}

async function getProfile() {
    const response = await fetch(`${API_BASE}/profile`, {
        method: 'GET',
        credentials: 'include',
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to get profile');
    }

    return response.json();
}

async function updateUsername(newUsername) {
    const response = await fetch(`${API_BASE}/update-username`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ new_username: newUsername }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to update username');
    }

    return response;
}

async function changePassword(currentPassword, newPassword) {
    const response = await fetch(`${API_BASE}/change-password`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
            current_password: currentPassword,
            new_password: newPassword
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to change password');
    }

    return response;
}

async function deleteAccount(password) {
    const response = await fetch(`${API_BASE}/account`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ password }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to delete account');
    }

    return response;
}

// Event Handlers
function initAuthPage() {
    currentPage = 'auth';

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            showSection(tabName);
            
            // Update active tab
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            clearMessages();
        });
    });

    // Profile link
    const profileLink = document.getElementById('profile-link');
    if (profileLink) {
        profileLink.addEventListener('click', () => {
            window.location.href = 'profile.html';
        });
    }

    // Logout
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    // Signup form
    document.getElementById('signup-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('signup-username').value;
        const password = document.getElementById('signup-password').value;

        try {
            await signup(username, password);
            showMessage('Account created successfully! You can now log in.', 'success');
            document.getElementById('signup-form').reset();
            // Switch to login tab
            document.getElementById('login-tab').click();
        } catch (error) {
            showMessage(error.message, 'error');
        }
    });

    // Login form
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;

        try {
            const data = await login(username, password);
            showMessage(`Welcome back, ${data.username}!`, 'success');
            document.getElementById('login-form').reset();
            // Redirect to profile after successful login
            setTimeout(() => {
                window.location.href = 'profile.html';
            }, 1000);
        } catch (error) {
            showMessage(error.message, 'error');
        }
    });

    // Check auth status on page load
    checkAuthStatus();
}

function initProfilePage() {
    currentPage = 'profile';

    // Back button
    document.getElementById('back-to-auth').addEventListener('click', () => {
        window.location.href = './';
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Profile action buttons
    document.getElementById('edit-username-btn').addEventListener('click', () => {
        showSection('edit-username-section');
        document.getElementById('new-username').focus();
    });

    document.getElementById('change-password-btn').addEventListener('click', () => {
        showSection('change-password-section');
        document.getElementById('current-password').focus();
    });

    document.getElementById('delete-account-btn').addEventListener('click', () => {
        showSection('delete-account-section');
        document.getElementById('delete-password').focus();
    });

    // Cancel buttons
    document.getElementById('cancel-username-edit').addEventListener('click', () => {
        showSection('profile-section');
        document.getElementById('edit-username-form').reset();
    });

    document.getElementById('cancel-password-change').addEventListener('click', () => {
        showSection('profile-section');
        document.getElementById('change-password-form').reset();
    });

    document.getElementById('cancel-delete').addEventListener('click', () => {
        showSection('profile-section');
        document.getElementById('delete-account-form').reset();
    });

    // Edit username form
    document.getElementById('edit-username-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newUsername = document.getElementById('new-username').value;

        try {
            await updateUsername(newUsername);
            showMessage('Username updated successfully!', 'success');
            document.getElementById('edit-username-form').reset();
            // Refresh profile data
            loadProfile();
            showSection('profile-section');
        } catch (error) {
            showMessage(error.message, 'error');
        }
    });

    // Change password form
    document.getElementById('change-password-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;

        try {
            await changePassword(currentPassword, newPassword);
            showMessage('Password changed successfully! You will need to log in again.', 'success');
            document.getElementById('change-password-form').reset();
            // Logout user since password changed
            setTimeout(() => {
                window.location.href = './';
            }, 2000);
        } catch (error) {
            showMessage(error.message, 'error');
        }
    });

    // Delete account form
    document.getElementById('delete-account-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('delete-password').value;

        if (!confirm('Are you absolutely sure you want to delete your account? This action cannot be undone.')) {
            return;
        }

        try {
            await deleteAccount(password);
            showMessage('Account deleted successfully. Goodbye!', 'success');
            setTimeout(() => {
                window.location.href = './';
            }, 2000);
        } catch (error) {
            showMessage(error.message, 'error');
        }
    });

    // Load profile data
    loadProfile();
}

async function loadProfile() {
    try {
        const profile = await getProfile();
        const role = profile.role || 'Customer';
        const roleRow = document.getElementById('profile-role-row');

        document.getElementById('profile-id').textContent = profile.id;
        document.getElementById('profile-username').textContent = profile.username;
        document.getElementById('profile-role').textContent = role;
        document.getElementById('profile-created').textContent = new Date(profile.created_at).toLocaleDateString();

        if (roleRow) {
            if (role === 'Customer') {
                roleRow.classList.add('hidden');
            } else {
                roleRow.classList.remove('hidden');
            }
        }
    } catch (error) {
        showMessage('Failed to load profile. Please log in again.', 'error');
        setTimeout(() => {
            window.location.href = './';
        }, 2000);
    }
}

async function handleLogout() {
    try {
        await logout();
        showMessage('Logged out successfully!', 'success');
        updateNavButtons(false);
        if (currentPage === 'profile') {
            setTimeout(() => {
                window.location.href = './';
            }, 1000);
        }
    } catch (error) {
        showMessage('Logout failed, but you may still be logged out.', 'error');
        updateNavButtons(false);
    }
}

// Initialize the appropriate page
document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.includes('profile.html')) {
        initProfilePage();
    } else {
        initAuthPage();
    }
});
