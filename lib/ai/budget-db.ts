import 'server-only';
import {getPool} from '@/db';
import {createAiBudget} from './budget';
import type {BudgetStore} from './gateway';
export const aiBudget:BudgetStore={reserve:(...args)=>createAiBudget(getPool()).reserve(...args)};
