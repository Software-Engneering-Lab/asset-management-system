import { CONDITIONS } from "@/lib/constants";
import type { AssetInput } from "@/lib/types";

/**
 * FR-07 / FR-09: checks required fields, formats and allowed values
 * before anything is saved. The database function checks again.
 */
export class AssetValidator {
  static fromForm(formData: FormData): {
    input: AssetInput | null;
    errors: Record<string, string>;
    values: Record<string, string>;
  } {
    const values: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") values[key] = value.trim();
    }
    const errors: Record<string, string> = {};
    const required = [
      "name",
      "description",
      "category_id",
      "quantity",
      "purchase_date",
      "estimated_value",
      "owning_department_id",
      "location",
      "condition",
    ];
    for (const field of required) {
      if (!values[field]) errors[field] = "This field is required.";
    }

    const quantity = Number(values.quantity);
    if (values.quantity && (!Number.isInteger(quantity) || quantity < 1)) {
      errors.quantity = "Quantity must be a whole number of at least 1.";
    }

    const value = Number(values.estimated_value);
    if (values.estimated_value && (Number.isNaN(value) || value < 0)) {
      errors.estimated_value = "Estimated value must be 0 or more (AED per unit).";
    }

    if (values.purchase_date && new Date(values.purchase_date) > new Date()) {
      errors.purchase_date = "Purchase date cannot be in the future.";
    }

    if (values.condition && !(CONDITIONS as readonly string[]).includes(values.condition)) {
      errors.condition = "Choose a condition from the list.";
    }

    if (values.name && values.name.length > 150) errors.name = "Name must be 150 characters or fewer.";
    if (values.location && values.location.length > 150) errors.location = "Location must be 150 characters or fewer.";

    const weight = values.weight_kg ? Number(values.weight_kg) : null;
    if (weight !== null && (Number.isNaN(weight) || weight < 0)) {
      errors.weight_kg = "Weight must be 0 or more.";
    }

    if (Object.keys(errors).length > 0) return { input: null, errors, values };

    return {
      input: {
        name: values.name,
        description: values.description,
        category_id: values.category_id,
        quantity,
        purchase_date: values.purchase_date,
        estimated_value: value,
        owning_department_id: values.owning_department_id,
        custodian_id: values.custodian_id || null,
        location: values.location,
        condition: values.condition,
        material_type: values.material_type || null,
        weight_kg: weight,
        expected_end_of_life: values.expected_end_of_life || null,
      },
      errors,
      values,
    };
  }
}
