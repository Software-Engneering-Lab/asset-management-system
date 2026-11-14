import type { RoleName } from "./constants";

export interface CurrentUser {
  userId: string;
  fullName: string;
  email: string;
  departmentId: string | null;
  departmentName: string | null;
  roles: RoleName[];
}

export interface Department {
  department_id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export interface AssetCategory {
  category_id: string;
  name: string;
  parent_category_id: string | null;
}

export interface Asset {
  asset_id: string;
  name: string;
  description: string;
  category_id: string;
  quantity: number;
  available_quantity: number;
  purchase_date: string;
  estimated_value: number;
  owning_department_id: string;
  custodian_id: string | null;
  location: string;
  condition: string;
  asset_state: string;
  is_published: boolean;
  material_type: string | null;
  weight_kg: number | null;
  expected_end_of_life: string | null;
  created_at: string;
  // joined rows
  asset_category?: { name: string } | null;
  department?: { name: string; code: string } | null;
  app_user?: { full_name: string } | null;
}

export interface AssetHistoryEvent {
  event_id: string;
  event_type: string;
  previous_state: string | null;
  new_state: string | null;
  details: string | null;
  event_at: string;
  app_user?: { full_name: string } | null;
}

export interface AssetInput {
  name: string;
  description: string;
  category_id: string;
  quantity: number;
  purchase_date: string;
  estimated_value: number;
  owning_department_id: string;
  custodian_id: string | null;
  location: string;
  condition: string;
  material_type: string | null;
  weight_kg: number | null;
  expected_end_of_life: string | null;
}

export interface SearchFilters {
  q?: string;
  categoryId?: string;
  condition?: string;
  departmentId?: string;
}

/** Result returned to a form after a server action. */
export interface FormState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
  values?: Record<string, string>;
}
