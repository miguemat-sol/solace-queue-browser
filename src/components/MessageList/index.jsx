import { useEffect, useState, useRef } from 'react';

import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { IconField } from 'primereact/iconfield';
import { InputIcon } from 'primereact/inputicon';
import { FilterMatchMode } from 'primereact/api';
import { Toast } from 'primereact/toast'

import MessageListToolbar from './MessageListToolbar';

import classes from './styles.module.css';

export default function MessageList({ sourceDefinition, browser, selectedMessage, onBrowseFromChange, onMessageSelect }) {
  const { sourceName } = sourceDefinition;
  const [replayLogTimeRange, setReplayLogTimeRange] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [allMessages, setAllMessages] = useState([]);
  const [messages, setMessages] = useState([]);
  const [globalFilterValue, setGlobalFilterValue] = useState('');
  const [filters, setFilters] = useState({
    global: { value: null, matchMode: FilterMatchMode.CONTAINS }
  });
  const toast = useRef(null);

  const loadMessages = async (loader, page = 'first') => {
    setIsLoading(true);
    try {
      const msgs = await loader();
      setAllMessages((prev) => {
        const merged = [...prev];
        msgs.forEach((m) => {
          if (!merged.some((x) => x.meta?.replicationGroupMsgId === m.meta?.replicationGroupMsgId)) {
            merged.push(m);
          }
        });
        return merged;
      });
      setMessages(msgs);
    } catch (err) {
      toast.current.show({ severity: 'error', summary: 'Error', detail: 'Error loading messages' });
      setMessages([]);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    browser.getReplayTimeRange().then((range) => setReplayLogTimeRange(range));
    setMessages([]);
    setAllMessages([]);
    loadMessages(() => browser.getFirstPage());
  }, [browser]);

  const handleRowSelection = (e) => {
    if (e.value !== null) {
      onMessageSelect?.(e.value);
    }
  };

  const handleFilterChange = (e) => {
    const value = e.target.value;
    setFilters({ global: { ...filters.global, value } });
    setGlobalFilterValue(value);
  };

  const handleFirstClick = () => {
    loadMessages(() => browser.getFirstPage());
  };

  const handleNextClick = () => {
    loadMessages(() => browser.getNextPage());
  };

  const handlePrevClick = () => {
    loadMessages(() => browser.getPrevPage());
  };

  const messageStatus = (message) => {
    return message.payload !== undefined ? null : (
      <i className="pi pi-question-circle text-yellow-500"></i>
    );
  }

  const formatDateTime = (message) => {
    const spooledEpoc = message.meta.spooledTime * 1000;
    const tzOffset = new Date(spooledEpoc).getTimezoneOffset() * 60000;
    return new Date(spooledEpoc - tzOffset).toISOString().replace('T', ' ').slice(0, 19);
  }

  const addFilterField = (message) => ({
    ...message, filterField: [
      message.payload,
      ...Object.values(message.meta || {}),
      ...Object.values(message.headers || {}),
      ...Object.values(message.userProperties || {})
    ]
  });

  const ListHeader = () => {
    return (
      <div className="flex justify-content-end">
        <IconField iconPosition="left">
          <InputIcon className="pi pi-search" />
          <InputText value={globalFilterValue} onChange={handleFilterChange} placeholder="Message Search" />
        </IconField>
      </div>
    );
  };

  const ListFooter = () => {
    return (
      <div>
        <Button text onClick={handleFirstClick}>First</Button>
        <Button text onClick={handlePrevClick} disabled={!browser.hasPrevPage()}>&lt; Prev</Button>
        <Button text onClick={handleNextClick} disabled={!browser.hasNextPage()}>Next &gt;</Button>
      </div>
    );
  };

  return (
    (sourceName) ? (
      <>
      <Toast ref={toast} />
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
        <MessageListToolbar sourceDefinition={sourceDefinition} minTime={replayLogTimeRange.min} maxTime={replayLogTimeRange.max} onChange={onBrowseFromChange} />
        <div style={{ flex: '1', overflow: 'hidden' }}>
          <DataTable
            className={classes.messageListTable}
            value={messages.map(addFilterField)}
            size="small"
            scrollable
            resizableColumns
            selectionMode="single"
            selection={selectedMessage}
            dataKey="meta.replicationGroupMsgId"
            onSelectionChange={handleRowSelection}
            globalFilterFields={['filterField']}
            filters={filters}
            header={ListHeader}
            footer={ListFooter}
            loading={isLoading}
            emptyMessage="No messages available"
          >
            <Column body={messageStatus} />
            <Column field="meta.msgId" header="Message ID" />
            <Column body={formatDateTime} header="Spooled Time" />
            <Column field="meta.attachmentSize" header="Attachment Size (B)" />
          </DataTable>
        </div>
      </div>
      </>
    ) : (
      <div style={{ margin: '1em' }}>Please select a queue or topic to browse.</div>
    )
  );
}