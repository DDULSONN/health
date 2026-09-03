"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_CONTACT_VCARD_BYTES,
  MAX_CONTACT_VCARD_PHONE_COUNT,
  normalizeImportedContactPhone,
  parseContactVCardPhones,
} from "@/lib/dating-contact-vcard";

const MAX_IMPORT_PHONE_COUNT = MAX_CONTACT_VCARD_PHONE_COUNT;

type PickedContact = {
  tel?: string[];
};

type ContactPickerNavigator = Navigator & {
  contacts?: {
    select: (properties: Array<"tel">, options: { multiple: boolean }) => Promise<PickedContact[]>;
  };
};

type SyncStatus = {
  count: number;
  lastSyncedAt: string | null;
  schemaMissing: boolean;
};

function formatSyncDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString("ko-KR");
}

export default function AdminContactImportPanel() {
  const vCardInputRef = useRef<HTMLInputElement | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isSamsungInternet, setIsSamsungInternet] = useState(false);
  const [status, setStatus] = useState<SyncStatus>({ count: 0, lastSyncedAt: null, schemaMissing: false });
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    setError("");
    try {
      const response = await fetch("/api/dating/contact-blocks/sync", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as {
        count?: number;
        last_synced_at?: string | null;
        schema_missing?: boolean;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "연락처 차단 현황을 불러오지 못했습니다.");
      setStatus({
        count: Number.isFinite(body.count) ? Math.max(0, Number(body.count)) : 0,
        lastSyncedAt: typeof body.last_synced_at === "string" ? body.last_synced_at : null,
        schemaMissing: body.schema_missing === true,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "연락처 차단 현황을 불러오지 못했습니다.");
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    const pickerNavigator = navigator as ContactPickerNavigator;
    const userAgent = navigator.userAgent;
    setSupported(Boolean(window.isSecureContext && pickerNavigator.contacts?.select));
    setIsIOS(
      /iPad|iPhone|iPod/i.test(userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
    setIsAndroid(/Android/i.test(userAgent));
    setIsSamsungInternet(/SamsungBrowser/i.test(userAgent));
    void loadStatus();
  }, [loadStatus]);

  const syncPhones = async (phones: string[]) => {
    if (!window.confirm(`선택한 전화번호 ${phones.length.toLocaleString("ko-KR")}개를 모든 매칭에서 차단할까요?`)) {
      setMessage("연락처 차단을 취소했습니다.");
      return false;
    }

    const response = await fetch("/api/dating/contact-blocks/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phones }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      imported_count?: number;
      total_count?: number;
      error?: string;
    };
    if (!response.ok || body.ok === false) throw new Error(body.error ?? "연락처 차단에 실패했습니다.");

    const importedCount = Number.isFinite(body.imported_count) ? Math.max(0, Number(body.imported_count)) : phones.length;
    const totalCount = Number.isFinite(body.total_count) ? Math.max(0, Number(body.total_count)) : status.count;
    setStatus({ count: totalCount, lastSyncedAt: new Date().toISOString(), schemaMissing: false });
    setMessage(`전화번호 ${importedCount.toLocaleString("ko-KR")}개를 확인해 모든 매칭에 차단 반영했습니다.`);
    return true;
  };

  const handleImport = async () => {
    if (importing || clearing) return;

    const pickerNavigator = navigator as ContactPickerNavigator;
    if (!window.isSecureContext || !pickerNavigator.contacts?.select) {
      setError("이 기기에서는 연락처 선택을 지원하지 않습니다. 안드로이드 모바일 Chrome에서 열어주세요.");
      setMessage("");
      return;
    }

    setImporting(true);
    setError("");
    setMessage("");
    try {
      const contacts = await pickerNavigator.contacts.select(["tel"], { multiple: true });
      const selectedPhones = contacts.flatMap((contact) => contact.tel ?? []);
      const phones = [
        ...new Set(selectedPhones.map((phone) => normalizeImportedContactPhone(phone)).filter(Boolean)),
      ];

      if (phones.length === 0) {
        setMessage("선택한 연락처에서 차단할 수 있는 휴대폰 번호를 찾지 못했습니다.");
        return;
      }
      if (phones.length > MAX_IMPORT_PHONE_COUNT) {
        setError(`한 번에 최대 ${MAX_IMPORT_PHONE_COUNT.toLocaleString("ko-KR")}개의 번호만 차단할 수 있습니다.`);
        return;
      }
      await syncPhones(phones);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setMessage("연락처 선택을 취소했습니다.");
      } else if (isSamsungInternet) {
        setError(
          "삼성 인터넷에서 연락처 선택창을 열지 못했습니다. 삼성 인터넷을 최신 버전으로 업데이트하거나 아래 ‘전체 연락처 파일 불러오기’를 이용해주세요."
        );
      } else {
        setError(caught instanceof Error ? caught.message : "연락처 차단에 실패했습니다.");
      }
    } finally {
      setImporting(false);
    }
  };

  const handleVCardFile = async (file: File | null) => {
    if (!file || importing || clearing) return;
    setImporting(true);
    setError("");
    setMessage("");
    try {
      if (file.size > MAX_CONTACT_VCARD_BYTES) {
        throw new Error("vCard 파일이 너무 큽니다. 아이폰에서 전화번호 항목만 선택해 다시 내보내주세요.");
      }

      const parsed = parseContactVCardPhones(await file.text());
      if (parsed.exceededLimit) {
        throw new Error(`한 번에 최대 ${MAX_IMPORT_PHONE_COUNT.toLocaleString("ko-KR")}개의 번호만 차단할 수 있습니다.`);
      }
      if (parsed.telephoneEntryCount === 0) {
        throw new Error("전화번호가 들어 있는 vCard(.vcf) 파일인지 확인해주세요.");
      }
      if (parsed.phones.length === 0) {
        throw new Error("차단할 수 있는 형식의 휴대폰 번호를 찾지 못했습니다.");
      }

      const synced = await syncPhones(parsed.phones);
      if (synced && parsed.invalidCount > 0) {
        setMessage(
          `유효한 전화번호 ${parsed.phones.length.toLocaleString("ko-KR")}개를 차단했고, 형식이 맞지 않는 ${parsed.invalidCount.toLocaleString("ko-KR")}개는 제외했습니다.`
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "vCard 연락처를 불러오지 못했습니다.");
    } finally {
      setImporting(false);
    }
  };

  const handleClear = async () => {
    if (importing || clearing || status.count === 0) return;
    if (!window.confirm("직접 입력한 번호를 포함해 휴대폰 번호 차단을 모두 해제할까요? 이후 매칭 화면에 다시 보일 수 있습니다.")) return;

    setClearing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/dating/contact-blocks/sync", { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || body.ok === false) throw new Error(body.error ?? "휴대폰 번호 차단 전체 해제에 실패했습니다.");
      setStatus({ count: 0, lastSyncedAt: null, schemaMissing: false });
      setMessage("휴대폰 번호 차단을 모두 해제했습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "휴대폰 번호 차단 전체 해제에 실패했습니다.");
    } finally {
      setClearing(false);
    }
  };

  const formattedSyncDate = formatSyncDate(status.lastSyncedAt);

  return (
    <div className="rounded-xl border border-violet-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-violet-900">휴대폰 연락처로 지인 차단</p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-600">
            휴대폰에서 직접 고른 연락처를 오픈카드·빠른매칭·1:1 매칭에서 서로 보이지 않게 처리합니다.
          </p>
        </div>
        <div className="rounded-lg bg-violet-50 px-3 py-2 text-right">
          <p className="text-[11px] text-violet-700">현재 등록</p>
          <p className="text-sm font-bold text-violet-900">{loadingStatus ? "확인 중" : `${status.count.toLocaleString("ko-KR")}개`}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
        <p className="text-xs font-semibold text-neutral-800">사용 방법</p>
        {supported === true ? (
          <p className="mt-1 text-[11px] leading-5 text-neutral-600">
            전체 연락처는 파일 하나로 한 번에 차단할 수 있습니다. 브라우저 연락처 선택창은 일부 연락처만 직접 고를 때 사용하세요.
          </p>
        ) : supported === false ? (
          <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">
            <p>
              {isIOS
                ? "아이폰은 웹에서 연락처를 바로 열 수 없어 vCard 파일로 가져옵니다."
                : isAndroid
                  ? isSamsungInternet
                    ? "현재 사용 중인 삼성 인터넷에서는 연락처 선택 기능이 활성화되지 않았습니다. 브라우저를 업데이트하거나 연락처 파일을 불러와주세요."
                    : "현재 Android 브라우저에서는 연락처 선택 기능이 활성화되지 않았습니다. 연락처 파일을 불러오면 바로 차단할 수 있습니다."
                : "현재 브라우저는 연락처 선택창을 지원하지 않아 vCard 파일로 가져올 수 있습니다."}
            </p>
            {isIOS ? (
              <details className="mt-2">
                <summary className="cursor-pointer font-semibold text-amber-950">아이폰에서 내보내는 방법</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-4">
                  <li>연락처 앱 왼쪽 위의 ‘목록’을 누릅니다.</li>
                  <li>‘모든 연락처’를 길게 누르고 ‘내보내기’를 선택합니다.</li>
                  <li>전화번호 항목만 선택한 뒤 ‘완료’를 누릅니다.</li>
                  <li>‘파일에 저장’한 다음 이 화면에서 해당 .vcf 파일을 선택합니다.</li>
                </ol>
              </details>
            ) : null}
          </div>
        ) : null}
        {isAndroid ? (
          <details className="mt-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[11px] leading-5 text-neutral-600">
            <summary className="cursor-pointer font-semibold text-neutral-800">삼성 연락처 전체를 한 번에 차단하는 방법</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>삼성 연락처 앱에서 메뉴를 열고 ‘연락처 관리’를 누릅니다.</li>
              <li>‘연락처 가져오기/내보내기’에서 ‘내보내기’를 선택합니다.</li>
              <li>휴대전화에 vCard(.vcf) 파일로 저장합니다.</li>
              <li>아래 ‘전체 연락처 파일 불러오기’에서 저장한 파일을 선택합니다.</li>
            </ol>
          </details>
        ) : null}
        <p className="mt-2 text-[11px] leading-5 text-neutral-500">
          연락처 파일은 서버에 올리지 않고 이 브라우저에서 전화번호만 추출합니다. 번호는 서버에서 복구할 수 없는 해시로 바뀌며 원문은 저장하지 않습니다.
        </p>
        {status.schemaMissing ? (
          <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[11px] leading-5 text-rose-700">
            서버의 지인 차단 테이블이 아직 준비되지 않아 등록할 수 없습니다.
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          ref={vCardInputRef}
          type="file"
          accept=".vcf,text/vcard,text/x-vcard"
          disabled={supported === null || importing || clearing || loadingStatus || status.schemaMissing}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = "";
            void handleVCardFile(file);
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => vCardInputRef.current?.click()}
          disabled={supported === null || importing || clearing || loadingStatus || status.schemaMissing}
          className={`h-10 rounded-lg px-4 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
            isAndroid || supported !== true
              ? "bg-violet-600 text-white"
              : "border border-violet-200 bg-white text-violet-800"
          }`}
        >
          {importing
            ? "연락처 확인 중..."
            : isAndroid
              ? "전체 연락처 한 번에 차단"
              : isIOS
                ? "아이폰 연락처 파일 선택"
                : "vCard 파일 선택"}
        </button>
        {supported === true && (
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={importing || clearing || loadingStatus || status.schemaMissing}
            className={`h-10 rounded-lg px-4 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
              isAndroid
                ? "border border-violet-200 bg-white text-violet-800"
                : "bg-violet-600 text-white"
            }`}
          >
            {importing ? "차단 반영 중..." : isAndroid ? "일부 연락처 직접 선택" : "휴대폰 연락처 선택"}
          </button>
        )}
        <button
          type="button"
          onClick={() => void loadStatus()}
          disabled={importing || clearing || loadingStatus}
          className="h-10 rounded-lg border border-violet-200 bg-white px-4 text-xs font-semibold text-violet-800 disabled:opacity-50"
        >
          {loadingStatus ? "확인 중..." : "현황 새로고침"}
        </button>
        <button
          type="button"
          onClick={() => void handleClear()}
          disabled={importing || clearing || loadingStatus || status.count === 0}
          className="h-10 rounded-lg border border-rose-200 bg-white px-4 text-xs font-semibold text-rose-700 disabled:opacity-50"
        >
          {clearing ? "해제 중..." : "번호 차단 전체 해제"}
        </button>
      </div>

      {supported === true && isAndroid ? (
        <p className="mt-2 text-[11px] leading-5 text-neutral-500">
          브라우저의 연락처 선택창에는 보안상 전체 선택이 없습니다. 전체 차단은 위의 첫 번째 버튼을 이용해주세요.
        </p>
      ) : null}

      {formattedSyncDate ? <p className="mt-2 text-[11px] text-neutral-500">최근 반영: {formattedSyncDate}</p> : null}
      {message ? <p className="mt-2 text-xs font-medium text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-2 text-xs font-medium text-rose-600">{error}</p> : null}
    </div>
  );
}
