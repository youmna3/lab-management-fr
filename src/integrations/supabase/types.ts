export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assignment_sessions: {
        Row: {
          assignment_id: string
          batch_id: string
          created_at: string
          id: string
          import_batch_id: string | null
          lab_id: string
          session_date: string
          session_group_id: string | null
          session_group_key: string | null
          session_time: string
          source: string
          updated_at: string
        }
        Insert: {
          assignment_id: string
          batch_id: string
          created_at?: string
          id?: string
          import_batch_id?: string | null
          lab_id: string
          session_date: string
          session_group_id?: string | null
          session_group_key?: string | null
          session_time: string
          source?: string
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          batch_id?: string
          created_at?: string
          id?: string
          import_batch_id?: string | null
          lab_id?: string
          session_date?: string
          session_group_id?: string | null
          session_group_key?: string | null
          session_time?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_sessions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_sessions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batch_budget_view"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "assignment_sessions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_sessions_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "schedule_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_sessions_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          allocation_run_id: string | null
          batch_id: string
          confirmed_price: number | null
          created_at: string
          days: number
          denied_reason: string | null
          id: string
          lab_id: string
          need_id: string | null
          is_current_allocation: boolean
          replaces_assignment_id: string | null
          notes: string | null
          sessions_per_day: number
          source: string
          status: Database["public"]["Enums"]["assignment_status"]
          time_slots: string[]
          updated_at: string
        }
        Insert: {
          allocation_run_id?: string | null
          batch_id: string
          confirmed_price?: number | null
          created_at?: string
          days?: number
          denied_reason?: string | null
          id?: string
          lab_id: string
          need_id?: string | null
          is_current_allocation?: boolean
          notes?: string | null
          sessions_per_day?: number
          source?: string
          replaces_assignment_id?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          time_slots?: string[]
          updated_at?: string
        }
        Update: {
          allocation_run_id?: string | null
          batch_id?: string
          confirmed_price?: number | null
          created_at?: string
          days?: number
          denied_reason?: string | null
          id?: string
          lab_id?: string
          need_id?: string | null
          is_current_allocation?: boolean
          notes?: string | null
          sessions_per_day?: number
          source?: string
          replaces_assignment_id?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          time_slots?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batch_budget_view"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "assignments_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_need_id_fkey"
            columns: ["need_id"]
            isOneToOne: false
            referencedRelation: "batch_needs"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action_title: string
          action_type: string
          batch_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          is_restorable: boolean
          metadata: Json | null
          new_value: Json | null
          old_value: Json | null
          project_id: string | null
          section: string
          tab: string
          user_email: string | null
          user_id: string | null
          user_name: string
          user_role: string
        }
        Insert: {
          action_title: string
          action_type: string
          batch_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          is_restorable?: boolean
          metadata?: Json | null
          new_value?: Json | null
          old_value?: Json | null
          project_id?: string | null
          section: string
          tab: string
          user_email?: string | null
          user_id?: string | null
          user_name?: string
          user_role?: string
        }
        Update: {
          action_title?: string
          action_type?: string
          batch_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          is_restorable?: boolean
          metadata?: Json | null
          new_value?: Json | null
          old_value?: Json | null
          project_id?: string | null
          section?: string
          tab?: string
          user_email?: string | null
          user_id?: string | null
          user_name?: string
          user_role?: string
        }
        Relationships: []
      }
      batch_allocation_outputs: {
        Row: {
          allocation_owner: string | null
          allocation_owner_email: string | null
          allocation_storage_path: string | null
          area_grade_summary: Json
          batch_id: string
          created_at: string
          dashboard_summary: Json
          generated_files: Json
          id: string
          lab_allocation: Json
          lab_pivot: Json
          logs: string[]
          master_allocation: Json
          overfill_details: Json
          preferences_applied: Json
          project_id: string | null
          shortfall_math: Json
          shortfall_text: string | null
          summary: Json
          unassigned_students: Json
          updated_at: string
        }
        Insert: {
          allocation_storage_path?: string | null
          area_grade_summary?: Json
          batch_id: string
          created_at?: string
          dashboard_summary?: Json
          generated_files?: Json
          id?: string
          lab_allocation?: Json
          lab_pivot?: Json
          logs?: string[]
          master_allocation?: Json
          overfill_details?: Json
          preferences_applied?: Json
          project_id?: string | null
          shortfall_math?: Json
          shortfall_text?: string | null
          summary?: Json
          unassigned_students?: Json
          updated_at?: string
        }
        Update: {
          allocation_storage_path?: string | null
          area_grade_summary?: Json
          batch_id?: string
          created_at?: string
          dashboard_summary?: Json
          generated_files?: Json
          id?: string
          lab_allocation?: Json
          lab_pivot?: Json
          logs?: string[]
          master_allocation?: Json
          overfill_details?: Json
          preferences_applied?: Json
          project_id?: string | null
          shortfall_math?: Json
          shortfall_text?: string | null
          summary?: Json
          unassigned_students?: Json
          updated_at?: string
        }
        Relationships: []
      }
      batch_group_classifications: {
        Row: {
          area: string | null
          batch_id: string
          grade: string | null
          group_id: string
          id: string
          lab_id: string | null
          notes: string | null
          project_id: string | null
          repeat_count: number
          student_count: number | null
          updated_at: string
          updated_by_name: string | null
          visit_type: string
        }
        Insert: {
          area?: string | null
          batch_id: string
          grade?: string | null
          group_id: string
          id?: string
          lab_id?: string | null
          notes?: string | null
          project_id?: string | null
          repeat_count?: number
          student_count?: number | null
          updated_at?: string
          updated_by_name?: string | null
          visit_type?: string
        }
        Update: {
          area?: string | null
          batch_id?: string
          grade?: string | null
          group_id?: string
          id?: string
          lab_id?: string | null
          notes?: string | null
          project_id?: string | null
          repeat_count?: number
          student_count?: number | null
          updated_at?: string
          updated_by_name?: string | null
          visit_type?: string
        }
        Relationships: []
      }
      batch_mega_groups: {
        Row: {
          batch_id: string
          created_at: string
          dates: string[] | null
          end_date: string | null
          id: string
          name: string
          project_id: string | null
          start_date: string | null
          student_ids: string[] | null
          target_areas: string[] | null
          target_grades: number[] | null
          time_slots: string[] | null
          updated_at: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          dates?: string[] | null
          end_date?: string | null
          id?: string
          name: string
          project_id?: string | null
          start_date?: string | null
          student_ids?: string[] | null
          target_areas?: string[] | null
          target_grades?: number[] | null
          time_slots?: string[] | null
          updated_at?: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          dates?: string[] | null
          end_date?: string | null
          id?: string
          name?: string
          project_id?: string | null
          start_date?: string | null
          student_ids?: string[] | null
          target_areas?: string[] | null
          target_grades?: number[] | null
          time_slots?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      batch_needs: {
        Row: {
          allocation_run_id: string | null
          area: string
          batch_id: string
          created_at: string
          gov: string
          id: string
          is_current_allocation: boolean
          labs_required: number
          source: string
        }
        Insert: {
          allocation_run_id?: string | null
          area: string
          batch_id: string
          created_at?: string
          gov: string
          id?: string
          is_current_allocation?: boolean
          labs_required?: number
          source?: string
        }
        Update: {
          allocation_run_id?: string | null
          area?: string
          batch_id?: string
          created_at?: string
          gov?: string
          id?: string
          is_current_allocation?: boolean
          labs_required?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "batch_needs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batch_budget_view"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "batch_needs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_resolution_requests: {
        Row: {
          area: string
          batch_id: string
          created_at: string
          grades: number[]
          history: Json
          id: string
          lab_id: string | null
          max_overfill_per_lab: number | null
          notes: string | null
          project_id: string | null
          reason: string | null
          requested_capacity: number | null
          reviewed_by_name: string | null
          reviewed_by_role: string | null
          reviewer_comment: string | null
          solver_rerun_at: string | null
          status: string
          submitted_by_name: string | null
          submitted_by_role: string | null
          suggested_nearest_area: string | null
          suggested_nearest_lab: string | null
          target_team: string
          time_slot_num: number | null
          type: string
          unassigned_count: number | null
          updated_at: string
        }
        Insert: {
          area: string
          batch_id: string
          created_at?: string
          grades?: number[]
          history?: Json
          id?: string
          lab_id?: string | null
          max_overfill_per_lab?: number | null
          notes?: string | null
          project_id?: string | null
          reason?: string | null
          requested_capacity?: number | null
          reviewed_by_name?: string | null
          reviewed_by_role?: string | null
          reviewer_comment?: string | null
          solver_rerun_at?: string | null
          status?: string
          submitted_by_name?: string | null
          submitted_by_role?: string | null
          suggested_nearest_area?: string | null
          suggested_nearest_lab?: string | null
          target_team: string
          time_slot_num?: number | null
          type: string
          unassigned_count?: number | null
          updated_at?: string
        }
        Update: {
          area?: string
          batch_id?: string
          created_at?: string
          grades?: number[]
          history?: Json
          id?: string
          lab_id?: string | null
          max_overfill_per_lab?: number | null
          notes?: string | null
          project_id?: string | null
          reason?: string | null
          requested_capacity?: number | null
          reviewed_by_name?: string | null
          reviewed_by_role?: string | null
          reviewer_comment?: string | null
          solver_rerun_at?: string | null
          status?: string
          submitted_by_name?: string | null
          submitted_by_role?: string | null
          suggested_nearest_area?: string | null
          suggested_nearest_lab?: string | null
          target_team?: string
          time_slot_num?: number | null
          type?: string
          unassigned_count?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      batch_student_uploads: {
        Row: {
          batch_id: string
          created_at: string
          file_name: string
          file_size: number
          id: string
          project_id: string | null
          raw_data: string | null
          storage_path: string | null
          checksum: string | null
          roster_version: number
          uploaded_by: string | null
          roster_summary: Json | null
          roster_grades: Json
          roster_areas: Json
          roster_preview: Json
          student_count: number
          students: Json
          updated_at: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          file_name: string
          file_size?: number
          id?: string
          project_id?: string | null
          raw_data?: string | null
          storage_path?: string | null
          checksum?: string | null
          roster_version?: number
          uploaded_by?: string | null
          roster_summary?: Json | null
          roster_grades?: Json
          roster_areas?: Json
          roster_preview?: Json
          student_count?: number
          students?: Json
          updated_at?: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          file_name?: string
          file_size?: number
          id?: string
          project_id?: string | null
          raw_data?: string | null
          storage_path?: string | null
          checksum?: string | null
          roster_version?: number
          uploaded_by?: string | null
          roster_summary?: Json | null
          roster_grades?: Json
          roster_areas?: Json
          roster_preview?: Json
          student_count?: number
          students?: Json
          updated_at?: string
        }
        Relationships: []
      }
      batches: {
        Row: {
          blocked_days: string[] | null
          created_at: string
          created_by: string | null
          date_mode: Database["public"]["Enums"]["date_mode"]
          dates: string[]
          expected_sessions_per_group: number | null
          group_distribution_mode: string
          id: string
          mega_groups: Json | null
          name: string
          notes: string | null
          project_id: string
          status: Database["public"]["Enums"]["batch_status"]
          time_slots: string[]
          updated_at: string
        }
        Insert: {
          blocked_days?: string[] | null
          created_at?: string
          created_by?: string | null
          date_mode?: Database["public"]["Enums"]["date_mode"]
          dates?: string[]
          expected_sessions_per_group?: number | null
          group_distribution_mode?: string
          id?: string
          mega_groups?: Json | null
          name: string
          notes?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["batch_status"]
          time_slots?: string[]
          updated_at?: string
        }
        Update: {
          blocked_days?: string[] | null
          created_at?: string
          created_by?: string | null
          date_mode?: Database["public"]["Enums"]["date_mode"]
          dates?: string[]
          expected_sessions_per_group?: number | null
          group_distribution_mode?: string
          id?: string
          mega_groups?: Json | null
          name?: string
          notes?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["batch_status"]
          time_slots?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_budget_view"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_items: {
        Row: {
          category: Database["public"]["Enums"]["catering_category"]
          created_at: string
          id: string
          is_active: boolean
          name: string
          unit_price: number
          updated_at: string
          vendor_id: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["catering_category"]
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          unit_price?: number
          updated_at?: string
          vendor_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["catering_category"]
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          unit_price?: number
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catering_items_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "catering_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_lines: {
        Row: {
          assignment_id: string
          created_at: string
          extra_fee: number
          extra_qty: number
          id: string
          lab_total: number | null
          notes: string | null
          provider: string | null
          sessions: number
          students: number
          type: Database["public"]["Enums"]["catering_type"]
          unit_price: number
          updated_at: string
        }
        Insert: {
          assignment_id: string
          created_at?: string
          extra_fee?: number
          extra_qty?: number
          id?: string
          lab_total?: number | null
          notes?: string | null
          provider?: string | null
          sessions?: number
          students?: number
          type: Database["public"]["Enums"]["catering_type"]
          unit_price?: number
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          created_at?: string
          extra_fee?: number
          extra_qty?: number
          id?: string
          lab_total?: number | null
          notes?: string | null
          provider?: string | null
          sessions?: number
          students?: number
          type?: Database["public"]["Enums"]["catering_type"]
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catering_lines_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_order_items: {
        Row: {
          created_at: string
          id: string
          item_id: string | null
          order_id: string
          quantity: number
          unit_price_snapshot: number
        }
        Insert: {
          created_at?: string
          id?: string
          item_id?: string | null
          order_id: string
          quantity?: number
          unit_price_snapshot?: number
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string | null
          order_id?: string
          quantity?: number
          unit_price_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "catering_order_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "catering_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "catering_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_orders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          ordered_at: string | null
          session_id: string
          status: Database["public"]["Enums"]["catering_order_status"]
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          ordered_at?: string | null
          session_id: string
          status?: Database["public"]["Enums"]["catering_order_status"]
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          ordered_at?: string | null
          session_id?: string
          status?: Database["public"]["Enums"]["catering_order_status"]
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catering_orders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "project_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "catering_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_providers: {
        Row: {
          area: string | null
          city: string | null
          contact_person: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          type: string
          unit_price: number
        }
        Insert: {
          area?: string | null
          city?: string | null
          contact_person?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          type?: string
          unit_price?: number
        }
        Update: {
          area?: string | null
          city?: string | null
          contact_person?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          type?: string
          unit_price?: number
        }
        Relationships: []
      }
      catering_vendors: {
        Row: {
          contact: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          contact?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          contact?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      lab_incidents: {
        Row: {
          batch_id: string | null
          category: string
          created_at: string
          description: string | null
          id: string
          lab_id: string
          project_id: string | null
          reported_at: string
          reported_by: string | null
          severity: string
          title: string
        }
        Insert: {
          batch_id?: string | null
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          lab_id: string
          project_id?: string | null
          reported_at?: string
          reported_by?: string | null
          severity?: string
          title: string
        }
        Update: {
          batch_id?: string | null
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          lab_id?: string
          project_id?: string | null
          reported_at?: string
          reported_by?: string | null
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_incidents_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batch_budget_view"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "lab_incidents_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_incidents_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_incidents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_budget_view"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "lab_incidents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_photos: {
        Row: {
          created_at: string
          id: string
          lab_id: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          lab_id: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          lab_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_photos_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_post_surveys: {
        Row: {
          batch_id: string | null
          cleanliness_rating: number | null
          created_at: string
          facilities_rating: number | null
          feedback: string | null
          id: string
          internet_rating: number | null
          lab_id: string
          overall_rating: number
          pc_rating: number | null
          project_id: string | null
          submitted_by: string | null
        }
        Insert: {
          batch_id?: string | null
          cleanliness_rating?: number | null
          created_at?: string
          facilities_rating?: number | null
          feedback?: string | null
          id?: string
          internet_rating?: number | null
          lab_id: string
          overall_rating: number
          pc_rating?: number | null
          project_id?: string | null
          submitted_by?: string | null
        }
        Update: {
          batch_id?: string | null
          cleanliness_rating?: number | null
          created_at?: string
          facilities_rating?: number | null
          feedback?: string | null
          id?: string
          internet_rating?: number | null
          lab_id?: string
          overall_rating?: number
          pc_rating?: number | null
          project_id?: string | null
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_post_surveys_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batch_budget_view"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "lab_post_surveys_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_post_surveys_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_post_surveys_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_budget_view"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "lab_post_surveys_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_quality: {
        Row: {
          ac: Database["public"]["Enums"]["ac_quality"]
          ac_count: number | null
          assessed_at: string | null
          assessed_by: string | null
          bathroom_boys: boolean
          bathroom_girls: boolean
          bathroom_type: string | null
          chairs_quality: number | null
          cleanliness: number | null
          created_at: string
          extra_activities: number
          floor_number: number | null
          has_elevator: boolean | null
          has_instructor_pc: boolean | null
          has_printer: boolean | null
          id: string
          image_urls: string[] | null
          internet_quality: number | null
          internet_speed_mbps: number | null
          lab_id: string
          lab_size: string | null
          notes: string | null
          parent_waiting_area: boolean | null
          pc_count: number | null
          pc_quality: number | null
          projector: boolean
          quality_score: number
          score_history: Json | null
          seated_capacity: number | null
          security: boolean
          street_view: number | null
          updated_at: string
          video_url: string | null
        }
        Insert: {
          ac?: Database["public"]["Enums"]["ac_quality"]
          ac_count?: number | null
          assessed_at?: string | null
          assessed_by?: string | null
          bathroom_boys?: boolean
          bathroom_girls?: boolean
          bathroom_type?: string | null
          chairs_quality?: number | null
          cleanliness?: number | null
          created_at?: string
          extra_activities?: number
          floor_number?: number | null
          has_elevator?: boolean | null
          has_instructor_pc?: boolean | null
          has_printer?: boolean | null
          id?: string
          image_urls?: string[] | null
          internet_quality?: number | null
          internet_speed_mbps?: number | null
          lab_id: string
          lab_size?: string | null
          notes?: string | null
          parent_waiting_area?: boolean | null
          pc_count?: number | null
          pc_quality?: number | null
          projector?: boolean
          quality_score?: number
          score_history?: Json | null
          seated_capacity?: number | null
          security?: boolean
          street_view?: number | null
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          ac?: Database["public"]["Enums"]["ac_quality"]
          ac_count?: number | null
          assessed_at?: string | null
          assessed_by?: string | null
          bathroom_boys?: boolean
          bathroom_girls?: boolean
          bathroom_type?: string | null
          chairs_quality?: number | null
          cleanliness?: number | null
          created_at?: string
          extra_activities?: number
          floor_number?: number | null
          has_elevator?: boolean | null
          has_instructor_pc?: boolean | null
          has_printer?: boolean | null
          id?: string
          image_urls?: string[] | null
          internet_quality?: number | null
          internet_speed_mbps?: number | null
          lab_id?: string
          lab_size?: string | null
          notes?: string | null
          parent_waiting_area?: boolean | null
          pc_count?: number | null
          pc_quality?: number | null
          projector?: boolean
          quality_score?: number
          score_history?: Json | null
          seated_capacity?: number | null
          security?: boolean
          street_view?: number | null
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_quality_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: true
            referencedRelation: "labs"
            referencedColumns: ["id"]
          },
        ]
      }
      labs: {
        Row: {
          address: string | null
          area: string | null
          capacity: number
          center_name: string | null
          city: string | null
          created_at: string
          created_by: string | null
          deactivation_reason: string | null
          domty: number | null
          facilitator_name: string | null
          facilitator_phone: string | null
          gov: string | null
          hourly_price: number
          id: string
          is_active: boolean
          lab_code: string | null
          lat: number | null
          lng: number | null
          location_address: string | null
          maps_url: string | null
          maps_verified: boolean | null
          maps_verified_at: string | null
          maps_verified_by: string | null
          maps_verified_note: string | null
          name: string
          notes: string | null
          quality_rating: number | null
          replaced_at: string | null
          replaced_by_lab_id: string | null
          session_price: number
          status: string
          students_count: number
          supervisor_name: string | null
          supervisor_phone: string | null
          updated_at: string
          validation_status: string
          vendor_name: string | null
          water_boxes: number | null
          water_vendor: string | null
          nearby_labs: Json | null
        }
        Insert: {
          address?: string | null
          area?: string | null
          capacity?: number
          center_name?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          deactivation_reason?: string | null
          domty?: number | null
          facilitator_name?: string | null
          facilitator_phone?: string | null
          gov?: string | null
          hourly_price?: number
          id?: string
          is_active?: boolean
          lab_code?: string | null
          lat?: number | null
          lng?: number | null
          location_address?: string | null
          maps_url?: string | null
          maps_verified?: boolean | null
          maps_verified_at?: string | null
          maps_verified_by?: string | null
          maps_verified_note?: string | null
          name: string
          notes?: string | null
          quality_rating?: number | null
          replaced_at?: string | null
          replaced_by_lab_id?: string | null
          session_price?: number
          status?: string
          students_count?: number
          supervisor_name?: string | null
          supervisor_phone?: string | null
          updated_at?: string
          validation_status?: string
          vendor_name?: string | null
          water_boxes?: number | null
          water_vendor?: string | null
          nearby_labs?: Json | null
        }
        Update: {
          address?: string | null
          area?: string | null
          capacity?: number
          center_name?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          deactivation_reason?: string | null
          domty?: number | null
          facilitator_name?: string | null
          facilitator_phone?: string | null
          gov?: string | null
          hourly_price?: number
          id?: string
          is_active?: boolean
          lab_code?: string | null
          lat?: number | null
          lng?: number | null
          location_address?: string | null
          maps_url?: string | null
          maps_verified?: boolean | null
          maps_verified_at?: string | null
          maps_verified_by?: string | null
          maps_verified_note?: string | null
          name?: string
          notes?: string | null
          quality_rating?: number | null
          replaced_at?: string | null
          replaced_by_lab_id?: string | null
          session_price?: number
          status?: string
          students_count?: number
          supervisor_name?: string | null
          supervisor_phone?: string | null
          updated_at?: string
          validation_status?: string
          vendor_name?: string | null
          water_boxes?: number | null
          water_vendor?: string | null
          nearby_labs?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "labs_replaced_by_lab_id_fkey"
            columns: ["replaced_by_lab_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_extra_costs: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          created_by: string | null
          id: string
          label: string
          project_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          project_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_extra_costs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_budget_view"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_extra_costs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_sessions: {
        Row: {
          confirmed_at: string | null
          created_at: string
          end_time: string
          id: string
          lab_id: string | null
          notes: string | null
          participants: number
          project_id: string
          session_date: string
          start_time: string
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          end_time?: string
          id?: string
          lab_id?: string | null
          notes?: string | null
          participants?: number
          project_id: string
          session_date: string
          start_time?: string
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          end_time?: string
          id?: string
          lab_id?: string | null
          notes?: string | null
          participants?: number
          project_id?: string
          session_date?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_sessions_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "labs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_budget_view"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "project_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          client: string | null
          code: string | null
          created_at: string
          end_date: string | null
          id: string
          intake_label: string | null
          name: string
          notes: string | null
          owner_id: string | null
          participants_per_session: number
          program: Database["public"]["Enums"]["program"] | null
          sessions_count: number
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          client?: string | null
          code?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          intake_label?: string | null
          name: string
          notes?: string | null
          owner_id?: string | null
          participants_per_session?: number
          program?: Database["public"]["Enums"]["program"] | null
          sessions_count?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          client?: string | null
          code?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          intake_label?: string | null
          name?: string
          notes?: string | null
          owner_id?: string | null
          participants_per_session?: number
          program?: Database["public"]["Enums"]["program"] | null
          sessions_count?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: []
      }
      role_navigation_permissions: {
        Row: {
          is_enabled: boolean
          role: string
          tab_key: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          is_enabled?: boolean
          role: string
          tab_key: string
          updated_at?: string
          updated_by?: string
        }
        Update: {
          is_enabled?: boolean
          role?: string
          tab_key?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: []
      }
      schedule_import_batches: {
        Row: {
          batch_id: string
          created_at: string
          created_by: string | null
          file_name: string
          id: string
          import_mode: string
          source: string
          total_session_rows: number
          total_target_assignments: number
        }
        Insert: {
          batch_id: string
          created_at?: string
          created_by?: string | null
          file_name: string
          id?: string
          import_mode: string
          source?: string
          total_session_rows?: number
          total_target_assignments?: number
        }
        Update: {
          batch_id?: string
          created_at?: string
          created_by?: string | null
          file_name?: string
          id?: string
          import_mode?: string
          source?: string
          total_session_rows?: number
          total_target_assignments?: number
        }
        Relationships: [
          {
            foreignKeyName: "schedule_import_batches_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batch_budget_view"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "schedule_import_batches_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
        ]
      }
      timeline_overrides: {
        Row: {
          batch_id: string | null
          created_at: string
          created_by: string | null
          event_date: string
          id: string
          kind: string
          label: string | null
          project_id: string
          updated_at: string
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          event_date: string
          id?: string
          kind?: string
          label?: string | null
          project_id: string
          updated_at?: string
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          event_date?: string
          id?: string
          kind?: string
          label?: string | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeline_overrides_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batch_budget_view"
            referencedColumns: ["batch_id"]
          },
          {
            foreignKeyName: "timeline_overrides_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_overrides_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_budget_view"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "timeline_overrides_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_request_notifications: {
        Row: {
          request_id: string
          seen_at: string
          seen_status: string
          user_id: string
        }
        Insert: {
          request_id: string
          seen_at?: string
          seen_status: string
          user_id: string
        }
        Update: {
          request_id?: string
          seen_at?: string
          seen_status?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      batch_budget_view: {
        Row: {
          batch_id: string | null
          batch_name: string | null
          catering_cost: number | null
          lab_cost: number | null
          project_id: string | null
          sandwich_cost: number | null
          status: Database["public"]["Enums"]["batch_status"] | null
          total_cost: number | null
          water_cost: number | null
        }
        Relationships: [
          {
            foreignKeyName: "batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_budget_view"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_budget_view: {
        Row: {
          catering_cost: number | null
          extras_cost: number | null
          intake: string | null
          lab_cost: number | null
          sandwich_cost: number | null
          total_cost: number | null
          water_cost: number | null
        }
        Relationships: []
      }
      project_budget_view: {
        Row: {
          catering_cost: number | null
          client: string | null
          extras_cost: number | null
          intake_label: string | null
          lab_cost: number | null
          name: string | null
          program: Database["public"]["Enums"]["program"] | null
          project_id: string | null
          sandwich_cost: number | null
          status: Database["public"]["Enums"]["project_status"] | null
          total_cost: number | null
          water_cost: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_assignment_sessions: {
        Args: {
          _batch_id: string
          _file_name: string
          _import_mode: string
          _sessions: Json
          _target_assignment_ids: string[]
        }
        Returns: string
      }
      lab_is_reserved: {
        Args: { _dates: string[]; _exclude_batch?: string; _lab_id: string }
        Returns: boolean
      }
      replace_assignment_schedule: {
        Args: {
          _assignment_id: string
          _import_batch_id?: string
          _sessions: Json
          _source?: string
        }
        Returns: undefined
      }
      seed_assignment_schedule: {
        Args: { _assignment_id: string }
        Returns: undefined
      }
      sync_assignment_schedule_legacy_fields: {
        Args: { _assignment_id: string }
        Returns: undefined
      }
      update_student_in_batch: {
        Args: {
          p_area?: string
          p_batch_id: string
          p_grade?: number
          p_status?: string
          p_student_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      ac_quality: "yes" | "no" | "partial"
      app_role: "lab_manager" | "operations" | "finance" | "administration"
      assignment_status: "pending" | "confirmed" | "denied"
      batch_status: "draft" | "assigning" | "confirming" | "ready" | "exported"
      catering_category: "sandwich" | "beverage" | "extra"
      catering_order_status: "draft" | "ordered" | "delivered" | "cancelled"
      catering_type: "sandwich" | "water"
      date_mode: "range" | "custom"
      program: "DECI" | "DEMI"
      project_status:
        | "draft"
        | "assigned"
        | "confirmed"
        | "completed"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ac_quality: ["yes", "no", "partial"],
      app_role: ["lab_manager", "operations", "finance", "administration"],
      assignment_status: ["pending", "confirmed", "denied"],
      batch_status: ["draft", "assigning", "confirming", "ready", "exported"],
      catering_category: ["sandwich", "beverage", "extra"],
      catering_order_status: ["draft", "ordered", "delivered", "cancelled"],
      catering_type: ["sandwich", "water"],
      date_mode: ["range", "custom"],
      program: ["DECI", "DEMI"],
      project_status: [
        "draft",
        "assigned",
        "confirmed",
        "completed",
        "cancelled",
      ],
    },
  },
} as const
