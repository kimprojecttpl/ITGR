// Bootstrap / admin-CLI user creation — needed at least once to create the
// first admin, since there's no self-service signup.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... PIN_PEPPER=... \
//     node scripts/create-user.mjs "Jane Doe" 4821 admin
import { createClient } from "@supabase/supabase-js";
import { hashPin } from "../lib/pin.js";

const [, , displayName, pin, role] = process.argv;
const VALID_ROLES = ["admin", "read_write", "read_only"];

if (!displayName || !pin || !VALID_ROLES.includes(role)) {
  console.error('Usage: node scripts/create-user.mjs "Display Name" <pin> <admin|read_write|read_only>');
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const pin_hash = hashPin(pin);

const { data, error } = await supabase
  .from("users")
  .insert({ display_name: displayName, role, pin_hash })
  .select("id, display_name, role")
  .single();

if (error) {
  console.error("Failed to create user:", error.message);
  process.exit(1);
}

console.log(`Created user: ${data.display_name} (${data.role}), id=${data.id}`);
