# Hylandee Static Site with Authentication

A vanilla HTML/CSS/JavaScript frontend for the Rust authentication API.

## Features

- **Sign Up**: Create new accounts with username/password validation
- **Login**: Authenticate existing users
- **Profile View**: View your account information
- **Change Username**: Update your username
- **Change Password**: Update your password (requires current password)
- **Delete Account**: Permanently delete your account

## Files

- `index.html` - Main site with links to various pages
- `auth/index.html` - Authentication page (signup/login)
- `auth/profile.html` - User profile management
- `auth/auth.css` - Styling for auth pages
- `auth/auth.js` - JavaScript for API interactions

## Setup

1. **Start the Rust API server** (make sure it's running on `http://127.0.0.1:3000`):

   ```bash
   cd /Users/dylan/dev/printedin3d-rs
   cargo run
   ```

2. **Open the static site**:
   - Open `index.html` in your browser
   - Click "Authentication Demo" to access the auth features

## API Endpoints Used

- `POST /signup` - Create new account
- `POST /login` - Authenticate user
- `POST /logout` - End session
- `GET /profile` - Get user profile
- `POST /update-username` - Change username
- `POST /change-password` - Change password
- `DELETE /account` - Delete account

## Security Notes

- All API calls include credentials (cookies)
- Passwords are validated client-side and server-side
- Sessions are managed via HTTP-only cookies
- Account deletion requires password confirmation

## Browser Compatibility

Works in all modern browsers that support:

- ES6+ JavaScript
- Fetch API
- CSS Grid/Flexbox
