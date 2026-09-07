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
        Relationships: [];
      };
      admins: {
        Row: {
          id: string;
          username: string;
          password_hash: string;
          role: 'super_admin' | 'secondary_admin' | 'emergency_admin';
          parent_id: string | null;
          is_active: boolean;
          is_pinned: boolean;
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
          role?: 'super_admin' | 'secondary_admin' | 'emergency_admin';
          parent_id?: string | null;
          is_active?: boolean;
          is_pinned?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
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
          tags: string[];
          is_pinned: boolean;
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
          tags?: string[];
          is_pinned?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
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
        Relationships: [];
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
        Relationships: [];
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
        Relationships: [];
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
        Relationships: [];
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
        Relationships: [];
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
        Relationships: [];
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
        Relationships: [];
      };
      cs_message_templates: {
        Row: {
          admin_id: string;
          content: string;
          content_type: string;
          created_at: string;
          id: string;
          is_pinned: boolean;
          name: string;
          sort_order: number;
          source_type: string;
          subtitle: string | null;
          title: string | null;
          updated_at: string;
        };
        Insert: {
          admin_id: string;
          content: string;
          content_type?: string;
          created_at?: string;
          id?: string;
          is_pinned?: boolean;
          name: string;
          sort_order?: number;
          source_type?: string;
          subtitle?: string | null;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          admin_id?: string;
          content?: string;
          content_type?: string;
          created_at?: string;
          id?: string;
          is_pinned?: boolean;
          name?: string;
          sort_order?: number;
          source_type?: string;
          subtitle?: string | null;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      customer_auto_messages: {
        Row: {
          admin_id: string;
          content: string;
          content_type: string;
          created_at: string;
          customer_id: string;
          id: string;
          is_enabled: boolean;
          message_type: string;
          name: string;
          sort_order: number;
          subtitle: string | null;
          title: string | null;
          updated_at: string;
        };
        Insert: {
          admin_id: string;
          content?: string;
          content_type?: string;
          created_at?: string;
          customer_id: string;
          id?: string;
          is_enabled?: boolean;
          message_type: string;
          name?: string;
          sort_order?: number;
          subtitle?: string | null;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          admin_id?: string;
          content?: string;
          content_type?: string;
          created_at?: string;
          customer_id?: string;
          id?: string;
          is_enabled?: boolean;
          message_type?: string;
          name?: string;
          sort_order?: number;
          subtitle?: string | null;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      customer_employee_conversations: {
        Row: {
          created_at: string;
          customer_id: string;
          employee_id: string;
          id: string;
          image_url: string | null;
          is_read: boolean;
          message_content: string;
          message_type: 'text' | 'image' | 'rating_request' | 'rating_result' | 'tip' | 'rich_card';
          rating_data: { rating?: number; comment?: string; employee_id?: string; status?: string; tip_amount?: number } | null;
          read_at: string | null;
          rich_card_content_id: string | null;
          sender_type: 'customer' | 'employee';
          source_auto_message_id: string | null;
          source_template_id: string | null;
          source_type: string;
          subtitle: string | null;
          title: string | null;
        };
        Insert: {
          created_at?: string;
          customer_id: string;
          employee_id: string;
          id?: string;
          image_url?: string | null;
          is_read?: boolean | null;
          message_content: string;
          message_type?: string | null;
          rating_data?: { rating?: number; comment?: string; employee_id?: string; status?: string; tip_amount?: number } | null;
          read_at?: string | null;
          rich_card_content_id?: string | null;
          sender_type: string;
          source_auto_message_id?: string | null;
          source_template_id?: string | null;
          source_type?: string;
          subtitle?: string | null;
          title?: string | null;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          employee_id?: string;
          id?: string;
          image_url?: string | null;
          is_read?: boolean | null;
          message_content?: string;
          message_type?: string | null;
          rating_data?: { rating?: number; comment?: string; employee_id?: string; status?: string; tip_amount?: number } | null;
          read_at?: string | null;
          rich_card_content_id?: string | null;
          sender_type?: string;
          source_auto_message_id?: string | null;
          source_template_id?: string | null;
          source_type?: string;
          subtitle?: string | null;
          title?: string | null;
        };
        Relationships: [];
      };
      customer_service_sessions: {
        Row: {
          closed_at: string | null;
          created_at: string | null;
          customer_id: string;
          employee_id: string;
          id: string;
          service_ticket_number: string;
          status: string;
        };
        Insert: {
          closed_at?: string | null;
          created_at?: string | null;
          customer_id: string;
          employee_id: string;
          id?: string;
          service_ticket_number: string;
          status?: string;
        };
        Update: {
          closed_at?: string | null;
          created_at?: string | null;
          customer_id?: string;
          employee_id?: string;
          id?: string;
          service_ticket_number?: string;
          status?: string;
        };
        Relationships: [];
      };
      rich_card_contents: {
        Row: {
          created_at: string;
          html_content: string;
          id: string;
          source_auto_message_id: string | null;
          source_template_id: string | null;
        };
        Insert: {
          created_at?: string;
          html_content: string;
          id?: string;
          source_auto_message_id?: string | null;
          source_template_id?: string | null;
        };
        Update: {
          created_at?: string;
          html_content?: string;
          id?: string;
          source_auto_message_id?: string | null;
          source_template_id?: string | null;
        };
        Relationships: [];
      };
      simulated_customers: {
        Row: {
          admin_id: string;
          badge_type: string | null;
          customer_avatar: string;
          customer_id: string;
          customer_name: string;
          custom_avatar_url: string | null;
          employee_always_visible: boolean;
          employee_pin_top: boolean;
          id: string;
          is_active: boolean | null;
          is_super: boolean;
          super_customer_title: string | null;
          target_employee_id: string | null;
          target_employee_ids: string[] | null;
          vip_label: string | null;
        };
        Insert: {
          admin_id: string;
          badge_type?: string | null;
          customer_avatar?: string | null;
          customer_id: string;
          customer_name: string;
          custom_avatar_url?: string | null;
          employee_always_visible?: boolean;
          employee_pin_top?: boolean;
          id?: string;
          is_active?: boolean | null;
          is_super?: boolean;
          super_customer_title?: string | null;
          target_employee_id?: string | null;
          target_employee_ids?: string[] | null;
          vip_label?: string | null;
        };
        Update: {
          admin_id?: string;
          badge_type?: string | null;
          customer_avatar?: string | null;
          customer_id?: string;
          customer_name?: string;
          custom_avatar_url?: string | null;
          employee_always_visible?: boolean;
          employee_pin_top?: boolean;
          id?: string;
          is_active?: boolean | null;
          is_super?: boolean;
          super_customer_title?: string | null;
          target_employee_id?: string | null;
          target_employee_ids?: string[] | null;
          vip_label?: string | null;
        };
        Relationships: [];
      };
      verification_requests: {
        Row: {
          audit_remark: string | null;
          audited_at: string | null;
          audited_by: string | null;
          created_at: string;
          email: string;
          id: string;
          id_back_url: string | null;
          id_front_url: string | null;
          phone: string;
          real_name: string;
          selfie_url: string | null;
          status: 'pending' | 'approved' | 'rejected';
          updated_at: string;
          user_id: string;
          wallet_address: string;
        };
        Insert: {
          audit_remark?: string | null;
          audited_at?: string | null;
          audited_by?: string | null;
          created_at?: string | null;
          email: string;
          id?: string;
          id_back_url?: string | null;
          id_front_url?: string | null;
          phone: string;
          real_name: string;
          selfie_url?: string | null;
          status?: string;
          updated_at?: string | null;
          user_id: string;
          wallet_address: string;
        };
        Update: {
          audit_remark?: string | null;
          audited_at?: string | null;
          audited_by?: string | null;
          created_at?: string | null;
          email?: string;
          id?: string;
          id_back_url?: string | null;
          id_front_url?: string | null;
          phone?: string;
          real_name?: string;
          selfie_url?: string | null;
          status?: string;
          updated_at?: string | null;
          user_id?: string;
          wallet_address?: string;
        };
        Relationships: [];
      };
    };
    Views: {};
    Functions: {
      get_employee_conversation_summaries: {
        Args: { p_employee_id: string };
        Returns: Array<{
          badge_type: string | null;
          custom_avatar_url: string | null;
          customer_avatar: string | null;
          customer_display_id: string;
          customer_id: string;
          customer_name: string;
          employee_always_visible: boolean | null;
          employee_pin_top: boolean | null;
          is_super: boolean | null;
          last_customer_message_time: string | null;
          last_message: string | null;
          last_message_time: string | null;
          last_message_type: string | null;
          super_customer_title: string | null;
          target_employee_id: string | null;
          target_employee_ids: string[] | null;
          unread_count: number;
          vip_label: string | null;
        }>;
      };
      get_or_create_service_session: {
        Args: { p_customer_id: string; p_employee_id: string };
        Returns: Array<{
          created_at: string;
          service_ticket_number: string;
          session_id: string;
        }>;
      };
    };
  };
}
