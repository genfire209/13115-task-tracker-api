-- Run this once against your Azure SQL Database to create the schema.

CREATE TABLE Users (
    id NVARCHAR(100) PRIMARY KEY,      -- email, used as the stable user id
    name NVARCHAR(200) NOT NULL,
    email NVARCHAR(200) NOT NULL,
    authProvider NVARCHAR(20) NOT NULL, -- 'google' or 'apple'
    role NVARCHAR(20) NOT NULL DEFAULT 'member', -- 'captain' or 'member'
    subteam NVARCHAR(20) NULL,          -- 'mechanical' | 'outreach' | 'programming' | 'strategy'; NULL = onboarding not complete
    banned BIT NOT NULL DEFAULT 0,      -- removed from the team by a captain; can no longer log in or appear in rosters
    pushToken NVARCHAR(500) NULL,
    createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE Tasks (
    id NVARCHAR(50) PRIMARY KEY,
    title NVARCHAR(300) NOT NULL,
    description NVARCHAR(MAX) NULL,
    category NVARCHAR(20) NOT NULL,     -- 'mechanical' | 'outreach' | 'programming'
    createdBy NVARCHAR(100) NOT NULL REFERENCES Users(id),
    assignedTo NVARCHAR(100) NULL REFERENCES Users(id),
    status NVARCHAR(30) NOT NULL DEFAULT 'open',
    -- 'open' | 'pending_acceptance' | 'accepted' | 'declined' | 'in_progress' | 'completed'
    dueDate DATETIME2 NOT NULL,
    createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE TaskEvents (
    id NVARCHAR(50) PRIMARY KEY,
    taskId NVARCHAR(50) NOT NULL REFERENCES Tasks(id),
    action NVARCHAR(50) NOT NULL,
    actorId NVARCHAR(100) NOT NULL REFERENCES Users(id),
    reason NVARCHAR(MAX) NULL,
    timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE ExtensionRequests (
    id NVARCHAR(50) PRIMARY KEY,
    taskId NVARCHAR(50) NOT NULL REFERENCES Tasks(id),
    requestedBy NVARCHAR(100) NOT NULL REFERENCES Users(id),
    newDueDate DATETIME2 NOT NULL,
    reason NVARCHAR(MAX) NOT NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'denied'
    createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE LoginEvents (
    id NVARCHAR(50) PRIMARY KEY,
    userId NVARCHAR(100) NOT NULL REFERENCES Users(id),
    email NVARCHAR(200) NOT NULL,
    timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE INDEX IX_Tasks_AssignedTo ON Tasks(assignedTo);
CREATE INDEX IX_TaskEvents_TaskId ON TaskEvents(taskId);
CREATE INDEX IX_ExtensionRequests_TaskId ON ExtensionRequests(taskId);
CREATE INDEX IX_LoginEvents_UserId ON LoginEvents(userId);
