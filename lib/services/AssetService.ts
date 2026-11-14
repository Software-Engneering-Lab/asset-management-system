import { createClient } from "@/lib/supabase/server";
import { throwIfError } from "@/lib/services/DataLoadError";
import { ASSET_STATES, ROLES } from "@/lib/constants";
import { AuthService } from "@/lib/auth/AuthService";
import type {
  Asset,
  AssetCategory,
  AssetHistoryEvent,
  AssetInput,
  CurrentUser,
  SearchFilters,
} from "@/lib/types";

const ASSET_COLUMNS =
  "asset_id, name, description, category_id, quantity, available_quantity, purchase_date, " +
  "estimated_value, owning_department_id, custodian_id, location, condition, asset_state, " +
  "is_published, material_type, weight_kg, expected_end_of_life, created_at, " +
  "asset_category(name), department(name, code), app_user(full_name)";

/**
 * C2 (register assets) and C3 (publish and search).
 * Writes go through database functions so the rules, history and audit
 * entry are saved together in one transaction (Phase 4-5, Section 6.4).
 */
export class AssetService {
  static async listCategories(): Promise<AssetCategory[]> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("asset_category")
      .select("category_id, name, parent_category_id")
      .order("name");
    throwIfError(error, "categories");
    return (data ?? []) as AssetCategory[];
  }

  /** Active custodians (with their department) who may be responsible for an asset. */
  static async listCustodians(): Promise<{ user_id: string; full_name: string; department_id: string }[]> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_custodians");
    throwIfError(error, "custodians");
    return (data ?? []) as { user_id: string; full_name: string; department_id: string }[];
  }

  /** FR-06, FR-07: register a new asset. Returns the new asset ID. */
  static async register(input: AssetInput): Promise<{ assetId?: string; error?: string }> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("register_asset", {
      p_name: input.name,
      p_description: input.description,
      p_category_id: input.category_id,
      p_quantity: input.quantity,
      p_purchase_date: input.purchase_date,
      p_estimated_value: input.estimated_value,
      p_owning_department_id: input.owning_department_id,
      p_custodian_id: input.custodian_id,
      p_location: input.location,
      p_condition: input.condition,
      p_material_type: input.material_type,
      p_weight_kg: input.weight_kg,
      p_expected_end_of_life: input.expected_end_of_life,
    });
    if (error) return { error: error.message };
    return { assetId: data as string };
  }

  /** FR-10: publish a registered asset as surplus. */
  static async publish(assetId: string): Promise<{ error?: string }> {
    const supabase = await createClient();
    const { error } = await supabase.rpc("publish_asset", { p_asset_id: assetId });
    return error ? { error: error.message } : {};
  }

  static async getById(assetId: string): Promise<Asset | null> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("asset")
      .select(ASSET_COLUMNS)
      .eq("asset_id", assetId)
      .maybeSingle();
    throwIfError(error, "the asset");
    // No error and no row = the asset does not exist or this user may not see it (404)
    return (data as unknown as Asset) ?? null;
  }

  /** Who did what, and when (feeds C6). */
  static async getHistory(assetId: string): Promise<AssetHistoryEvent[]> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("asset_history_event")
      .select("event_id, event_type, previous_state, new_state, details, event_at, app_user(full_name)")
      .eq("asset_id", assetId)
      .order("event_at", { ascending: false });
    throwIfError(error, "the asset history");
    return (data ?? []) as unknown as AssetHistoryEvent[];
  }

  /** Assets this user manages: their department or their custody (admins see all). */
  static async listManaged(user: CurrentUser): Promise<Asset[]> {
    const supabase = await createClient();
    let query = supabase.from("asset").select(ASSET_COLUMNS).order("created_at", { ascending: false });

    if (!AuthService.hasRole(user, ROLES.ADMIN, ROLES.APPROVER)) {
      const filters = [`custodian_id.eq.${user.userId}`];
      if (user.departmentId) filters.push(`owning_department_id.eq.${user.departmentId}`);
      query = query.or(filters.join(","));
    }
    const { data, error } = await query;
    throwIfError(error, "your department's assets");
    return (data ?? []) as unknown as Asset[];
  }

  /**
   * Can this user publish this asset? Admin, or a custodian of the OWNING department.
   * Being the asset's custodian alone is not enough. (Shows the button; the database checks again.)
   */
  static canPublish(user: CurrentUser, asset: Asset): boolean {
    if (asset.asset_state !== ASSET_STATES.REGISTERED) return false;
    if (AuthService.hasRole(user, ROLES.ADMIN)) return true;
    return AuthService.hasRole(user, ROLES.CUSTODIAN) && asset.owning_department_id === user.departmentId;
  }

  /** FR-12, FR-13: keyword search + filters over published, available assets only. */
  static async search(filters: SearchFilters): Promise<Asset[]> {
    const supabase = await createClient();
    let query = supabase
      .from("asset")
      .select(ASSET_COLUMNS)
      .eq("is_published", true)
      .eq("asset_state", ASSET_STATES.AVAILABLE)
      .gt("available_quantity", 0)
      .order("name");

    const keyword = (filters.q ?? "").replace(/[,()%*\\]/g, " ").trim();
    if (keyword) query = query.or(`name.ilike.%${keyword}%,description.ilike.%${keyword}%`);
    if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
    if (filters.condition) query = query.eq("condition", filters.condition);
    if (filters.departmentId) query = query.eq("owning_department_id", filters.departmentId);

    const { data, error } = await query;
    throwIfError(error, "search results");
    return (data ?? []) as unknown as Asset[];
  }
}
