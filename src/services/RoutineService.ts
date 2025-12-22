import { db } from '../config/firebase';
import {
    collection,
    addDoc,
    getDocs,
    getDoc,
    doc,
    updateDoc,
    deleteDoc,
    query,
    where,
    Timestamp
} from 'firebase/firestore';
import { Routine, RoutineSegment } from '../models/types';

const ROUTINES_COLLECTION = 'routines';

class RoutineService {
    /**
     * Create a new routine
     */
    async createRoutine(routine: Omit<Routine, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
        try {
            const routineData = {
                ...routine,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            };

            const docRef = await addDoc(collection(db, ROUTINES_COLLECTION), routineData);
            console.log('Routine created with ID:', docRef.id);
            return docRef.id;
        } catch (error) {
            console.error('Error creating routine:', error);
            throw error;
        }
    }

    /**
     * Get all routines for a user
     */
    async getUserRoutines(userId: string): Promise<Routine[]> {
        try {
            const q = query(
                collection(db, ROUTINES_COLLECTION),
                where('userId', '==', userId)
            );

            const snapshot = await getDocs(q);
            const routines: Routine[] = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate(),
                updatedAt: doc.data().updatedAt?.toDate(),
            } as Routine));

            return routines;
        } catch (error) {
            console.error('Error getting routines:', error);
            throw error;
        }
    }

    /**
     * Get a single routine by ID
     */
    async getRoutine(routineId: string): Promise<Routine | null> {
        try {
            const docRef = doc(db, ROUTINES_COLLECTION, routineId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                return {
                    id: docSnap.id,
                    ...docSnap.data(),
                    createdAt: docSnap.data().createdAt?.toDate(),
                    updatedAt: docSnap.data().updatedAt?.toDate(),
                } as Routine;
            }

            return null;
        } catch (error) {
            console.error('Error getting routine:', error);
            throw error;
        }
    }

    /**
     * Update an existing routine
     */
    async updateRoutine(routineId: string, updates: Partial<Routine>): Promise<void> {
        try {
            const docRef = doc(db, ROUTINES_COLLECTION, routineId);
            await updateDoc(docRef, {
                ...updates,
                updatedAt: Timestamp.now(),
            });
            console.log('Routine updated:', routineId);
        } catch (error) {
            console.error('Error updating routine:', error);
            throw error;
        }
    }

    /**
     * Delete a routine
     */
    async deleteRoutine(routineId: string): Promise<void> {
        try {
            const docRef = doc(db, ROUTINES_COLLECTION, routineId);
            await deleteDoc(docRef);
            console.log('Routine deleted:', routineId);
        } catch (error) {
            console.error('Error deleting routine:', error);
            throw error;
        }
    }

    /**
     * Toggle routine active status
     */
    async toggleRoutineActive(routineId: string, active: boolean): Promise<void> {
        try {
            await this.updateRoutine(routineId, { active });
        } catch (error) {
            console.error('Error toggling routine:', error);
            throw error;
        }
    }

    /**
     * Get active routines for a user
     */
    async getActiveRoutines(userId: string): Promise<Routine[]> {
        try {
            const q = query(
                collection(db, ROUTINES_COLLECTION),
                where('userId', '==', userId),
                where('active', '==', true)
            );

            const snapshot = await getDocs(q);
            const routines: Routine[] = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate(),
                updatedAt: doc.data().updatedAt?.toDate(),
            } as Routine));

            return routines;
        } catch (error) {
            console.error('Error getting active routines:', error);
            throw error;
        }
    }
}

export default new RoutineService();
