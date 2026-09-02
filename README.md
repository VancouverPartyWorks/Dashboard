# Vancouver PartyWorks - Admin Dashboard

A centralized web administration portal for **Vancouver PartyWorks**, designed for managing event operations, staff scheduling, timesheet approvals, expense receipts, and company resources.

---

## 🚀 Features

- 📊 **Executive Dashboard**: Real-time KPI summaries, shift analytics, event volume metrics, and interactive charts powered by ApexCharts.
- 👥 **User & Role Management**: Manage staff profiles, assign permissions and roles (Admin, Manager, Staff), and toggle active/inactive statuses.
- 📅 **Shift Scheduling & Dispatch**: Create, assign, and organize event shifts with date/time filters and rental software integration.
- ⏱️ **Timesheet Approvals & Tracking**: Review submitted staff hours, track shift logs, approve work durations, and export records directly to Excel (`.xlsx`).
- 🧾 **Receipt & Expense Management**: Track team expenditures and review submitted receipts with Firebase Cloud Storage integration.
- 📚 **Resource Library**: Centralized repository for operational manuals, equipment safety guides, training materials, and documents.
- 🔐 **Authentication & Access Control**: Secure Firebase Authentication, session verification, and role-based page protection guards.

---

## 🛠️ Tech Stack

- **Build Tool**: [Vite](https://vitejs.dev/) (v6)
- **UI & Styling**: HTML5, SCSS / [Bootstrap 5](https://getbootstrap.com/), [Tabler Icons](https://tabler.io/icons), [Bootstrap Icons](https://icons.getbootstrap.com/)
- **Charts & Visualizations**: [ApexCharts](https://apexcharts.com/)
- **Data Export**: [SheetJS (xlsx)](https://docs.sheetjs.com/)
- **Backend & Services**: [Firebase](https://firebase.google.com/) (Auth, Cloud Firestore, Cloud Storage)
- **API Integration**: Rental Software API Integration (via Vite reverse proxy)

---

## 📁 Project Structure

```text
VancouverPartyWorksAdmin/
├── src/
│   ├── assets/
│   │   ├── images/          # Image assets, icons, and logos
│   │   ├── js/              # Client-side JavaScript modules
│   │   │   ├── auth.js              # Authentication logic & sign-in handling
│   │   │   ├── checkRoles.js        # Role-based route & action guard
│   │   │   ├── dashboard.js         # Dashboard statistics & charts logic
│   │   │   ├── firebase-client.js   # Firebase SDK initialization
│   │   │   ├── pre-auth.js          # Pre-render session check
│   │   │   ├── receipts.js          # Receipt upload & management
│   │   │   ├── resources.js         # Resource document management
│   │   │   ├── shifts.js            # Shift scheduling & assignment
│   │   │   ├── timesheet.js         # Timesheet review & Excel exports
│   │   │   └── users.js             # User accounts & role management
│   │   └── scss/            # Custom Sass styles and theme variables
│   ├── index.html           # Main Dashboard
│   ├── shifts.html          # Shifts Management
│   ├── timesheet.html       # Timesheets & Hours Log
│   ├── receipts.html        # Expense Receipts
│   ├── resources.html       # Company Documents & Resources
│   ├── users.html           # User & Staff Management
│   ├── docs.html            # Documentation
│   ├── signin.html          # Login / Sign In page
│   └── 404-error.html       # 404 Error page
├── dist/                    # Compiled production build output
├── vite.config.js           # Vite configuration & multi-page rollup setup
├── package.json             # Project metadata and dependencies
└── README.md                # Project documentation
```

---

## ⚙️ Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18.x or higher recommended)
- [npm](https://www.npmjs.com/) (or yarn / pnpm)

### 1. Installation

Clone the repository and install the project dependencies:

```bash
# Clone the repository
git clone <repository-url>

# Navigate into the project folder
cd VancouverPartyWorksAdmin

# Install dependencies
npm install
```

### 2. Environment Configuration

Create a `.env` file in the root directory (if not already present):

```env
VITE_IO_API_KEY=your_rental_software_api_key_here
```

Firebase configuration is managed in [src/assets/js/firebase-client.js](src/assets/js/firebase-client.js).

### 3. Development Server

Run the local development server:

```bash
npm run dev
```

The application will be accessible at `http://localhost:3000/`.

---

## 📦 Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the Vite development server with Hot Module Replacement (HMR) |
| `npm run build` | Compiles and bundles all HTML pages and assets into the `dist/` directory |
| `npm run preview` | Locally preview the production build in `dist/` |

---

## 🚢 Deployment

To create a production build for static hosting:

```bash
npm run build
```

The resulting `dist/` directory can be deployed to any static web hosting provider, such as:
- **Firebase Hosting**
- **Vercel**
- **Netlify**
- **AWS S3 + CloudFront**
- **Nginx / Apache server**

---

## 🔒 Security & Access

- Access to administrative sections requires authenticated credentials verified against Firebase Auth.
- Unauthenticated requests are automatically redirected to `signin.html` via `pre-auth.js`.
- User roles and authorization restrictions are enforced via Firestore user collection records and `checkRoles.js`.
