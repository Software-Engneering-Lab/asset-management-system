"use server";

import { createClient } from "@/lib/supabase/server";

type SubmitResult =
  | { success: true; requestId: string }
  | { success: false; message: string };

export async function submitRequest(
  formData: FormData,
): Promise<SubmitResult> {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim() : "";
  };

  const category = text("category");
  const specifications = text("specifications");
  const purpose = text("purpose");
  const quantityText = text("quantity");
  const quantity = Number(quantityText);
  const condition = text("preferred_condition");
  const urgency = text("urgency");
  const location = text("preferred_location");
  const requiredDate = text("required_date");

  if (!category || category.length > 100) {
    return {
      success: false,
      message: "Select a valid category.",
    };
  }

  if (!specifications || specifications.length > 5000) {
    return {
      success: false,
      message: "Specifications must contain 1–5,000 characters.",
    };
  }

  if (!purpose || purpose.length > 5000) {
    return {
      success: false,
      message: "Purpose must contain 1–5,000 characters.",
    };
  }

  if (
    !/^\d+$/.test(quantityText) ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 2147483647
  ) {
    return {
      success: false,
      message: "Enter a valid positive whole quantity.",
    };
  }

  if (condition && !["Good", "Fair", "Poor"].includes(condition)) {
    return {
      success: false,
      message: "Select a valid condition.",
    };
  }

  if (!["Low", "Normal", "High"].includes(urgency)) {
    return {
      success: false,
      message: "Select a valid urgency.",
    };
  }

  if (location.length > 150) {
    return {
      success: false,
      message: "Location must not exceed 150 characters.",
    };
  }

  if (requiredDate) {
    const parsedDate = new Date(`${requiredDate}T00:00:00Z`);

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(requiredDate) ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== requiredDate
    ) {
      return {
        success: false,
        message: "Enter a valid required date.",
      };
    }
  }

  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        message: "Please sign in before submitting a request.",
      };
    }

    // This database function will be defined in our NEW migration.
    // It must check the requester role, derive the department,
    // and save the request and its history in one transaction.
    const { data, error } = await supabase.rpc(
      "shaikha_submit_request",
      {
        p_category_name: category,
        p_specifications: specifications,
        p_quantity: quantity,
        p_preferred_condition: condition || null,
        p_purpose: purpose,
        p_urgency: urgency,
        p_preferred_location: location || null,
        p_required_date: requiredDate || null,
      },
    );

    if (error) {
      if (error.code === "PGRST202") {
        return {
          success: false,
          message:
            "Request submission is not enabled yet. The reviewed request migration must be applied.",
        };
      }

      if (error.code === "42501") {
        return {
          success: false,
          message:
            "Your account is not authorized to submit requests. Your profile and requester role may need setup.",
        };
      }

      return {
        success: false,
        message:
          "The request could not be saved. Please check your account setup and try again.",
      };
    }

    if (typeof data !== "string" || !data) {
      return {
        success: false,
        message:
          "The server returned an unexpected response. Check your request list before trying again.",
      };
    }

    return { success: true, requestId: data };
  } catch {
    return {
      success: false,
      message:
        "Unable to connect. Check your connection and try again.",
    };
  }
}
export type RequestWorkspace = {
  department_name: string;
  categories: {
    category_id: string;
    name: string;
  }[];
  requests: {
    request_id: string;
    category: string;
    specifications: string;
    quantity: number;
    purpose: string;
    urgency: string;
    preferred_condition: string | null;
    preferred_location: string | null;
    required_date: string | null;
    request_status: string;
    created_at: string;
    submitted_at: string | null;
    history: {
      history_id: string;
      from_status: string | null;
      to_status: string;
      changed_at: string;
      reason: string | null;
    }[];
  }[];
};

type WorkspaceResult =
  | { success: true; data: RequestWorkspace }
  | { success: false; message: string };

export async function loadRequestWorkspace(): Promise<WorkspaceResult> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        message: "Please sign in to view your requests.",
      };
    }

    const { data, error } = await supabase.rpc(
      "shaikha_request_workspace",
    );

    if (error) {
      if (error.code === "PGRST202") {
        return {
          success: false,
          message:
            "Request tracking is not enabled yet. The reviewed C4 migrations must be applied.",
        };
      }

      if (error.code === "42501") {
        return {
          success: false,
          message:
            "Access is unavailable. Ask the team to verify your active profile, department and requester role.",
        };
      }

      return {
        success: false,
        message: "Unable to load requests. Please try again.",
      };
    }

    if (
      !data ||
      typeof data.department_name !== "string" ||
      !Array.isArray(data.categories) ||
      !Array.isArray(data.requests)
    ) {
      return {
        success: false,
        message: "The database returned an unexpected response.",
      };
    }

    return {
      success: true,
      data: data as RequestWorkspace,
    };
  } catch {
    return {
      success: false,
      message: "Unable to connect. Please try again.",
    };
  }
}
