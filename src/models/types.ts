export interface RoutineSegment {
    id: string;
    sequenceOrder: number;
    transitType: 'bus' | 'skytrain' | 'seabus';
    routeNumber: string;
    stopId: string;
    stopName: string;
    scheduledTime: string; // HH:MM format
    direction: string;
    destination: string;
}

export interface Routine {
    id: string;
    userId: string;
    name: string;
    frequency: 'daily' | 'weekly' | 'custom';
    daysOfWeek?: number[]; // 0-6 for Sunday-Saturday
    active: boolean;
    segments: RoutineSegment[];
    createdAt: Date;
    updatedAt: Date;
}

export interface UserNotification {
    id: string;
    userId: string;
    routineId?: string;
    type: 'DELAY_ALERT' | 'BOARDING_REMINDER' | 'ROUTE_SUGGESTION' | 'CHECK_IN_PROMPT';
    message: string;
    read: boolean;
    createdAt: Date;
    metadata?: {
        routeNo?: string;
        delay?: number;
        alternativeRoute?: string;
    };
}

export interface User {
    id: string;
    email: string;
    preferences: {
        notificationsEnabled: boolean;
        locationTrackingEnabled: boolean;
        boardingReminderMinutes: number;
    };
    createdAt: Date;
}
