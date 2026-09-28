import { and, eq, gte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.ts";
import type { OrderStatus } from "./order-domain.ts";
import type { OrderTransitionDependencies } from "./order-transition.ts";
import { audit, ledgerSums } from "./finance-db.ts";

const { installationJobs, inventory, orderItems, orders, shipments } = schema;

/** The real PostgreSQL side of transitionOrder: row lock, compare-and-set, stock release, side records and audit in one transaction. */
export function orderTransitionDeps(db: NodePgDatabase<typeof schema>): OrderTransitionDependencies {
  return {
    transaction: (work) => db.transaction(async (tx) => work({
      lockOrder:async(orderId)=>{const [row]=await tx.select({status:orders.status,total:orders.total,paymentStatus:orders.paymentStatus}).from(orders).where(eq(orders.id,orderId)).for("update").limit(1);return row?{status:row.status as OrderStatus,total:row.total,paymentStatus:row.paymentStatus}:null},
      ledgerSums:(orderId)=>ledgerSums(tx,orderId),
      listItems:(orderId)=>tx.select({productId:orderItems.productId,quantity:orderItems.quantity}).from(orderItems).where(eq(orderItems.orderId,orderId)),
      compareAndSetStatus:async(orderId,expected,next,paymentStatus)=>{const changed=await tx.update(orders).set({status:next,paymentStatus,updatedAt:new Date()}).where(and(eq(orders.id,orderId),eq(orders.status,expected))).returning({id:orders.id});return changed.length===1},
      releaseInventory:async(productId,quantity)=>{const changed=await tx.update(inventory).set({onHand:sql`${inventory.onHand}+${quantity}`,reserved:sql`${inventory.reserved}-${quantity}`,version:sql`${inventory.version}+1`,updatedAt:new Date()}).where(and(eq(inventory.productId,productId),gte(inventory.reserved,quantity))).returning({id:inventory.id});return changed.length===1},
      createShipment:async(orderId,status)=>{await tx.insert(shipments).values({id:crypto.randomUUID(),orderId,status,shippedAt:status==="shipped"?new Date():null}).onConflictDoNothing()},
      createInstallationJob:async(orderId)=>{await tx.insert(installationJobs).values({id:crypto.randomUUID(),orderId,status:"pending"})},
      insertAudit:({actor,orderId,from,to,paymentStatus,stockReleased})=>audit(tx,actor,"status","order",orderId,{from,to,paymentStatus,...(stockReleased?{stockReleased}:{})}),
    })),
  };
}
