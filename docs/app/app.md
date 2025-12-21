# Bible On Site - Mobile & Desktop Application

## Overview

Bible On Site is a cross-platform application available on **Android**, **iOS**, and **Windows**. Users can download the app from their respective platform stores:

- **Google Play Store** (Android)
- **Apple App Store** (iOS)
- **Microsoft Store** (Windows)

## High Level Architecture

![App High Level Architecture](app-high-level-architecture.svg)

## Technology Evolution

The application has evolved through multiple technology stacks:

| Generation | Technology | Notes |
|------------|------------|-------|
| 1st | Cordova | Cross-platform hybrid |
| 2nd | Cordova / Swift | Hybrid with native iOS |
| 3rd | Flutter | Cross-platform with Dart |
| 4th (current) | .NET MAUI | Cross-platform with C#/XAML |

### Data Sources

The app uses a hybrid data strategy:

1. **Local SQLite Database** - Stores static content that rarely changes:
   - Tanah contents (Sefarim, Perakim, Pesukim)
   - Commentaries from Rabbis z"l (of blessed memory)

2. **API Service** - Provides dynamic content that updates frequently

### Firebase Integration

The app integrates with Firebase for:

- **User Settings Storage** - Persisting user preferences across devices
- **Push Notifications** - Delivering updates and reminders via Firebase Cloud Messaging (FCM)
