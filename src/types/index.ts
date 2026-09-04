export interface Admin {
  id: string;
  username: string;
  role: 'super_admin' | 'secondary_admin' | 'emergency_admin';
  parent_id: string | null;
  is_active: boolean;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface Employee {
  id: string;
  username: string;
  employee_id: string;
  is_verified: boolean;
  is_active: boolean;
  total_income: number;
  first_success_order_date: string | null;
  created_by: string;
  remarks: string;
  tags: string[];
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductType {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  user_id: string;
  username: string;
  product_type_id: string;
  product_value: number;
  order_number: string;
  transaction_id: string;
  status: 'processing' | 'success' | 'failure';
  commission_amount: number | null;
  commission_rate: number | null;
  processed_at: string | null;
  created_at: string;
}

export interface Wallet {
  user_id: string;
  available_balance: number;
  frozen_balance: number;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  user_id: string;
  type: 'commission' | 'withdrawal_request' | 'withdrawal_approved' | 'withdrawal_rejected' | 'manual_adjustment' | 'tip';
  amount: number;
  balance_before: number;
  balance_after: number;
  reference_id: string | null;
  remarks: string;
  created_by: string | null;
  created_at: string;
}

export interface Withdrawal {
  id: string;
  user_id: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  audit_remark: string | null;
  audited_by: string | null;
  audited_at: string | null;
  created_at: string;
}

export interface AdminConfig {
  id: string;
  admin_id: string | null;
  config_type: 'commission_rate' | 'success_rate' | 'withdrawal_amount_threshold' | 'withdrawal_days_threshold';
  config_value: string;
  created_at: string;
  updated_at: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  is_pinned: boolean;
  is_global: boolean;
  is_hidden: boolean;
  pin_order: number;
  category: string | null;
  publish_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AnnouncementListItem {
  id: string;
  title: string;
  is_pinned: boolean;
  is_global: boolean;
  is_hidden: boolean;
  pin_order: number;
  category: string | null;
  publish_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface VerificationRequest {
  id: string;
  user_id: string;
  real_name: string;
  wallet_address: string;
  phone: string;
  email: string;
  status: 'pending' | 'approved' | 'rejected';
  audit_remark: string | null;
  audited_by: string | null;
  audited_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  sender_id: string;
  sender_username: string;
  title: string;
  content: string;
  message_type: 'login_popup' | 'realtime';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  expires_at: string | null;
  created_at: string;
}

export interface MessageRecipient {
  id: string;
  message_id: string;
  recipient_id: string;
  is_read: boolean;
  read_at: string | null;
  is_shown: boolean;
  shown_at: string | null;
  created_at: string;
}

export interface MessageWithRecipient extends MessageRecipient {
  messages: Message;
}

export interface MessageStats {
  total_recipients: number;
  read_count: number;
  unread_count: number;
  read_percentage: number;
}

export interface AdminGroup {
  id: string;
  username: string;
  role: 'super_admin' | 'secondary_admin' | 'emergency_admin';
  total_employees: number;
  active_employees: number;
  verified_employees: number;
}

export interface AuthState {
  user: Admin | Employee | null;
  userType: 'admin' | 'employee' | null;
}
