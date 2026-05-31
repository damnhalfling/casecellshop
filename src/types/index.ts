export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  imageUrl: string;
}

export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

export interface OrderItem {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface Order {
  id: string;
  items: OrderItem[];
  status: OrderStatus;
  totalAmount: number;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
  retryCount: number;
  errorMessage?: string;
}

export interface CheckoutRequest {
  items: { productId: string; quantity: number }[];
  idempotencyKey: string;
}

export interface CheckoutResponse {
  orderId: string;
  status: OrderStatus;
  message: string;
}

export interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttl: number;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  staleServed: number;
  invalidations: number;
}
