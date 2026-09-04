export interface Database {
  public: {
    Tables: {
      employee_login_history: {
        Row: {
          id: string;
          user_id: string;
          username: string;
          employee_id: string;
          action_type: 'login' | 'logout';
          ip_address: string | null;
          user_agent: string | null;
          session_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          username: string;
          employee_id: string;
          action_type: 'login' | 'logout';
          ip_address?: string | null;
          user_agent?: string | null;
          session_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          username?: string;
          employee_id?: string;
          action_type?: 'login' | 'logout';
          ip_address?: string | null;
          user_agent?: string | null;
          session_id?: string | null;
          created_at?: string;
        };
      };
      admins: {
        Row: {
          id: string;
          username: string;
          password_hash: string;
          role: 'super_admin' | 'secondary_admin';
          parent_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          username: string;
          password_hash: string;
          role: 'super_admin' | 'secondary_admin';
          parent_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          password_hash?: string;
          role?: 'super_admin' | 'secondary_admin';
          parent_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      users: {
        Row: {
          id: string;
          username: string;
          password_hash: string;
          employee_id: string;
          is_verified: boolean;
          is_active: boolean;
          total_income: number;
          first_success_order_date: string | null;
          created_by: string;
          remarks: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          username: string;
          password_hash: string;
          employee_id: string;
          is_verified?: boolean;
          is_active?: boolean;
          total_income?: number;
          first_success_order_date?: string | null;
          created_by: string;
          remarks?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          password_hash?: string;
          employee_id?: string;
          is_verified?: boolean;
          is_active?: boolean;
          total_income?: number;
          first_success_order_date?: string | null;
          created_by?: string;
          remarks?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      product_types: {
        Row: {
          id: string;
          name: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      orders: {
        Row: {
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
        };
        Insert: {
          id?: string;
          user_id: string;
          username: string;
          product_type_id: string;
          product_value: number;
          order_number: string;
          transaction_id: string;
          status?: 'processing' | 'success' | 'failure';
          commission_amount?: number | null;
          commission_rate?: number | null;
          processed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          username?: string;
          product_type_id?: string;
          product_value?: number;
          order_number?: string;
          transaction_id?: string;
          status?: 'processing' | 'success' | 'failure';
          commission_amount?: number | null;
          commission_rate?: number | null;
          processed_at?: string | null;
          created_at?: string;
        };
      };
      wallets: {
        Row: {
          user_id: string;
          available_balance: number;
          frozen_balance: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          available_balance?: number;
          frozen_balance?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          available_balance?: number;
          frozen_balance?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      wallet_transactions: {
        Row: {
          id: string;
          user_id: string;
          type: 'commission' | 'withdrawal_request' | 'withdrawal_approved' | 'withdrawal_rejected' | 'manual_adjustment';
          amount: number;
          balance_before: number;
          balance_after: number;
          reference_id: string | null;
          remarks: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: 'commission' | 'withdrawal_request' | 'withdrawal_approved' | 'withdrawal_rejected' | 'manual_adjustment';
          amount: number;
          balance_before: number;
          balance_after: number;
          reference_id?: string | null;
          remarks?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: 'commission' | 'withdrawal_request' | 'withdrawal_approved' | 'withdrawal_rejected' | 'manual_adjustment';
          amount?: number;
          balance_before?: number;
          balance_after?: number;
          reference_id?: string | null;
          remarks?: string;
          created_by?: string | null;
          created_at?: string;
        };
      };
      withdrawals: {
        Row: {
          id: string;
          user_id: string;
          amount: number;
          status: 'pending' | 'approved' | 'rejected';
          audit_remark: string | null;
          audited_by: string | null;
          audited_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          amount: number;
          status?: 'pending' | 'approved' | 'rejected';
          audit_remark?: string | null;
          audited_by?: string | null;
          audited_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          amount?: number;
          status?: 'pending' | 'approved' | 'rejected';
          audit_remark?: string | null;
          audited_by?: string | null;
          audited_at?: string | null;
          created_at?: string;
        };
      };
      admin_configs: {
        Row: {
          id: string;
          admin_id: string | null;
          config_type: 'commission_rate' | 'success_rate' | 'withdrawal_amount_threshold' | 'withdrawal_days_threshold';
          config_value: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          admin_id?: string | null;
          config_type: 'commission_rate' | 'success_rate' | 'withdrawal_amount_threshold' | 'withdrawal_days_threshold';
          config_value: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          admin_id?: string | null;
          config_type?: 'commission_rate' | 'success_rate' | 'withdrawal_amount_threshold' | 'withdrawal_days_threshold';
          config_value?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      announcements: {
        Row: {
          id: string;
          title: string;
          content: string;
          is_pinned: boolean;
          publish_at: string;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          content: string;
          is_pinned?: boolean;
          publish_at?: string;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          content?: string;
          is_pinned?: boolean;
          publish_at?: string;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}
