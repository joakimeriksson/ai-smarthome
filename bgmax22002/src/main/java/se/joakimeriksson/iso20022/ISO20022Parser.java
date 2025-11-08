package se.joakimeriksson.iso20022;

import org.w3c.dom.*;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.File;
import java.io.InputStream;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

/**
 * Parser for ISO 20022 payment files (camt.053 and camt.054).
 * This replaces the BGMAX format reader for Swedish banks.
 *
 * Supports:
 * - camt.053: Bank to Customer Account Statement
 * - camt.054: Bank to Customer Debit/Credit Notification
 */
public class ISO20022Parser {

    private static final String CAMT_053_NS = "urn:iso:std:iso:20022:tech:xsd:camt.053.001.02";
    private static final String CAMT_054_NS = "urn:iso:std:iso:20022:tech:xsd:camt.054.001.02";

    /**
     * Parse an ISO 20022 XML file from a file path
     */
    public AccountStatement parseFile(String filePath) throws Exception {
        File file = new File(filePath);
        return parseFile(file);
    }

    /**
     * Parse an ISO 20022 XML file
     */
    public AccountStatement parseFile(File file) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        DocumentBuilder builder = factory.newDocumentBuilder();
        Document doc = builder.parse(file);
        return parseDocument(doc);
    }

    /**
     * Parse an ISO 20022 XML from an InputStream
     */
    public AccountStatement parseStream(InputStream inputStream) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        DocumentBuilder builder = factory.newDocumentBuilder();
        Document doc = builder.parse(inputStream);
        return parseDocument(doc);
    }

    /**
     * Parse the XML Document and determine if it's camt.053 or camt.054
     */
    private AccountStatement parseDocument(Document doc) throws Exception {
        Element root = doc.getDocumentElement();
        String rootName = root.getLocalName();

        // If root is Document, get the first child element
        Element messageElement = root;
        if ("Document".equals(rootName)) {
            NodeList children = root.getChildNodes();
            for (int i = 0; i < children.getLength(); i++) {
                if (children.item(i) instanceof Element) {
                    messageElement = (Element) children.item(i);
                    break;
                }
            }
        }

        String messageName = messageElement.getLocalName();
        if ("BkToCstmrStmt".equals(messageName)) {
            return parseCamt053(doc);
        } else if ("BkToCstmrDbtCdtNtfctn".equals(messageName)) {
            return parseCamt054(doc);
        } else {
            throw new IllegalArgumentException("Unknown document type: " + messageName +
                ". Expected camt.053 (BkToCstmrStmt) or camt.054 (BkToCstmrDbtCdtNtfctn)");
        }
    }

    /**
     * Parse camt.053 - Bank to Customer Account Statement
     */
    private AccountStatement parseCamt053(Document doc) throws Exception {
        AccountStatement statement = new AccountStatement();

        // Parse Group Header
        NodeList grpHdr = doc.getElementsByTagNameNS("*", "GrpHdr");
        if (grpHdr.getLength() > 0) {
            Element grpHdrElement = (Element) grpHdr.item(0);
            statement.setMessageId(getElementText(grpHdrElement, "MsgId"));
            String creDtTm = getElementText(grpHdrElement, "CreDtTm");
            if (creDtTm != null && !creDtTm.isEmpty()) {
                statement.setCreationDateTime(parseDateTime(creDtTm));
            }
        }

        // Parse Statement
        NodeList stmtList = doc.getElementsByTagNameNS("*", "Stmt");
        if (stmtList.getLength() > 0) {
            Element stmtElement = (Element) stmtList.item(0);

            // Statement ID
            statement.setStatementId(getElementText(stmtElement, "Id"));

            // Account
            NodeList acctList = stmtElement.getElementsByTagNameNS("*", "Acct");
            if (acctList.getLength() > 0) {
                Element acctElement = (Element) acctList.item(0);
                NodeList ibanList = acctElement.getElementsByTagNameNS("*", "IBAN");
                if (ibanList.getLength() > 0) {
                    statement.setAccountIban(ibanList.item(0).getTextContent());
                }
                statement.setAccountCurrency(getElementText(acctElement, "Ccy"));
            }

            // Balances
            NodeList balList = stmtElement.getElementsByTagNameNS("*", "Bal");
            for (int i = 0; i < balList.getLength(); i++) {
                Element balElement = (Element) balList.item(i);
                String balType = getElementText(balElement, "Tp");
                String cdOrPrtry = getElementText(balElement, "Cd");
                String amtStr = getElementText(balElement, "Amt");

                if (amtStr != null && !amtStr.isEmpty()) {
                    BigDecimal amount = new BigDecimal(amtStr);
                    if ("OPBD".equals(cdOrPrtry) || (balType != null && balType.contains("Opening"))) {
                        statement.setOpeningBalance(amount);
                    } else if ("CLBD".equals(cdOrPrtry) || (balType != null && balType.contains("Closing"))) {
                        statement.setClosingBalance(amount);
                    }
                }
            }

            // Date range
            NodeList frToDtList = stmtElement.getElementsByTagNameNS("*", "FrToDt");
            if (frToDtList.getLength() > 0) {
                Element frToDtElement = (Element) frToDtList.item(0);
                String fromDt = getElementText(frToDtElement, "FrDtTm");
                String toDt = getElementText(frToDtElement, "ToDtTm");
                if (fromDt != null && !fromDt.isEmpty()) {
                    statement.setFromDateTime(parseDateTime(fromDt));
                }
                if (toDt != null && !toDt.isEmpty()) {
                    statement.setToDateTime(parseDateTime(toDt));
                }
            }

            // Parse Entries (Transactions)
            NodeList entryList = stmtElement.getElementsByTagNameNS("*", "Ntry");
            for (int i = 0; i < entryList.getLength(); i++) {
                Element entryElement = (Element) entryList.item(i);
                Payment payment = parseEntry(entryElement);
                if (payment != null) {
                    statement.addPayment(payment);
                }
            }
        }

        return statement;
    }

    /**
     * Parse camt.054 - Bank to Customer Debit/Credit Notification
     */
    private AccountStatement parseCamt054(Document doc) throws Exception {
        AccountStatement statement = new AccountStatement();

        // Parse Group Header
        NodeList grpHdr = doc.getElementsByTagNameNS("*", "GrpHdr");
        if (grpHdr.getLength() > 0) {
            Element grpHdrElement = (Element) grpHdr.item(0);
            statement.setMessageId(getElementText(grpHdrElement, "MsgId"));
            String creDtTm = getElementText(grpHdrElement, "CreDtTm");
            if (creDtTm != null && !creDtTm.isEmpty()) {
                statement.setCreationDateTime(parseDateTime(creDtTm));
            }
        }

        // Parse Notification
        NodeList ntfctnList = doc.getElementsByTagNameNS("*", "Ntfctn");
        if (ntfctnList.getLength() > 0) {
            Element ntfctnElement = (Element) ntfctnList.item(0);

            // Account
            NodeList acctList = ntfctnElement.getElementsByTagNameNS("*", "Acct");
            if (acctList.getLength() > 0) {
                Element acctElement = (Element) acctList.item(0);
                NodeList ibanList = acctElement.getElementsByTagNameNS("*", "IBAN");
                if (ibanList.getLength() > 0) {
                    statement.setAccountIban(ibanList.item(0).getTextContent());
                }
                statement.setAccountCurrency(getElementText(acctElement, "Ccy"));
            }

            // Parse Entries (Transactions)
            NodeList entryList = ntfctnElement.getElementsByTagNameNS("*", "Ntry");
            for (int i = 0; i < entryList.getLength(); i++) {
                Element entryElement = (Element) entryList.item(i);
                Payment payment = parseEntry(entryElement);
                if (payment != null) {
                    statement.addPayment(payment);
                }
            }
        }

        return statement;
    }

    /**
     * Parse a single entry (transaction) element
     */
    private Payment parseEntry(Element entryElement) {
        Payment payment = new Payment();

        // Amount
        String amtStr = getElementText(entryElement, "Amt");
        if (amtStr != null && !amtStr.isEmpty()) {
            payment.setAmount(new BigDecimal(amtStr));
        }

        // Currency
        NodeList amtList = entryElement.getElementsByTagNameNS("*", "Amt");
        if (amtList.getLength() > 0) {
            Element amtElement = (Element) amtList.item(0);
            String currency = amtElement.getAttribute("Ccy");
            payment.setCurrency(currency);
        }

        // Credit/Debit Indicator
        String cdtDbtInd = getElementText(entryElement, "CdtDbtInd");
        payment.setCreditDebitIndicator("CRDT".equals(cdtDbtInd));

        // Booking Date
        String bookDt = getElementText(entryElement, "BookgDt");
        if (bookDt != null && !bookDt.isEmpty()) {
            NodeList dtList = entryElement.getElementsByTagNameNS("*", "Dt");
            if (dtList.getLength() > 0) {
                String dateStr = dtList.item(0).getTextContent();
                if (dateStr != null && !dateStr.isEmpty()) {
                    payment.setBookingDate(parseDate(dateStr));
                }
            }
        }

        // Value Date
        String valDt = getElementText(entryElement, "ValDt");
        if (valDt != null && !valDt.isEmpty()) {
            NodeList dtList = entryElement.getElementsByTagNameNS("*", "Dt");
            if (dtList.getLength() > 1) {
                String dateStr = dtList.item(1).getTextContent();
                if (dateStr != null && !dateStr.isEmpty()) {
                    payment.setValueDate(parseDateTime(dateStr));
                }
            }
        }

        // Account Servicer Reference
        payment.setAccountServicerReference(getElementText(entryElement, "AcctSvcrRef"));

        // Bank Transaction Code
        NodeList bkTxCdList = entryElement.getElementsByTagNameNS("*", "BkTxCd");
        if (bkTxCdList.getLength() > 0) {
            Element bkTxCdElement = (Element) bkTxCdList.item(0);
            String prtryCode = getElementText(bkTxCdElement, "Prtry");
            payment.setBankTransactionCode(prtryCode);
        }

        // Entry Details (contains transaction details)
        NodeList ntryDtlsList = entryElement.getElementsByTagNameNS("*", "NtryDtls");
        if (ntryDtlsList.getLength() > 0) {
            Element ntryDtlsElement = (Element) ntryDtlsList.item(0);

            // Transaction Details
            NodeList txDtlsList = ntryDtlsElement.getElementsByTagNameNS("*", "TxDtls");
            if (txDtlsList.getLength() > 0) {
                Element txDtlsElement = (Element) txDtlsList.item(0);

                // References
                NodeList refsList = txDtlsElement.getElementsByTagNameNS("*", "Refs");
                if (refsList.getLength() > 0) {
                    Element refsElement = (Element) refsList.item(0);
                    payment.setTransactionId(getElementText(refsElement, "TxId"));
                    payment.setEndToEndId(getElementText(refsElement, "EndToEndId"));
                    payment.setMandateId(getElementText(refsElement, "MndtId"));
                }

                // Related Parties
                parseRelatedParties(txDtlsElement, payment);

                // Remittance Information
                NodeList rmtInfList = txDtlsElement.getElementsByTagNameNS("*", "RmtInf");
                if (rmtInfList.getLength() > 0) {
                    Element rmtInfElement = (Element) rmtInfList.item(0);

                    // Unstructured remittance info
                    String ustrd = getElementText(rmtInfElement, "Ustrd");
                    if (ustrd != null && !ustrd.isEmpty()) {
                        payment.setRemittanceInformation(ustrd);
                    }

                    // Structured remittance info (OCR reference)
                    NodeList strdList = rmtInfElement.getElementsByTagNameNS("*", "Strd");
                    if (strdList.getLength() > 0) {
                        Element strdElement = (Element) strdList.item(0);
                        NodeList cdtrRefInfList = strdElement.getElementsByTagNameNS("*", "CdtrRefInf");
                        if (cdtrRefInfList.getLength() > 0) {
                            Element cdtrRefInfElement = (Element) cdtrRefInfList.item(0);
                            String ref = getElementText(cdtrRefInfElement, "Ref");
                            if (ref != null && !ref.isEmpty()) {
                                payment.setOcrReference(ref);
                            }
                        }
                    }
                }
            }
        }

        return payment;
    }

    /**
     * Parse related parties (debtor and creditor information)
     */
    private void parseRelatedParties(Element txDtlsElement, Payment payment) {
        // Related Parties
        NodeList rltdPtiesList = txDtlsElement.getElementsByTagNameNS("*", "RltdPties");
        if (rltdPtiesList.getLength() > 0) {
            Element rltdPtiesElement = (Element) rltdPtiesList.item(0);

            // Debtor
            NodeList dbtrList = rltdPtiesElement.getElementsByTagNameNS("*", "Dbtr");
            if (dbtrList.getLength() > 0) {
                Element dbtrElement = (Element) dbtrList.item(0);
                payment.setDebtorName(getElementText(dbtrElement, "Nm"));
            }

            // Debtor Account
            NodeList dbtrAcctList = rltdPtiesElement.getElementsByTagNameNS("*", "DbtrAcct");
            if (dbtrAcctList.getLength() > 0) {
                Element dbtrAcctElement = (Element) dbtrAcctList.item(0);
                NodeList ibanList = dbtrAcctElement.getElementsByTagNameNS("*", "IBAN");
                if (ibanList.getLength() > 0) {
                    payment.setDebtorAccount(ibanList.item(0).getTextContent());
                }
            }

            // Debtor Agent (Bank)
            NodeList dbtrAgtList = rltdPtiesElement.getElementsByTagNameNS("*", "DbtrAgt");
            if (dbtrAgtList.getLength() > 0) {
                Element dbtrAgtElement = (Element) dbtrAgtList.item(0);
                NodeList finInstnIdList = dbtrAgtElement.getElementsByTagNameNS("*", "FinInstnId");
                if (finInstnIdList.getLength() > 0) {
                    Element finInstnIdElement = (Element) finInstnIdList.item(0);
                    payment.setDebtorBankBic(getElementText(finInstnIdElement, "BIC"));
                }
            }

            // Creditor
            NodeList cdtrList = rltdPtiesElement.getElementsByTagNameNS("*", "Cdtr");
            if (cdtrList.getLength() > 0) {
                Element cdtrElement = (Element) cdtrList.item(0);
                payment.setCreditorName(getElementText(cdtrElement, "Nm"));
            }

            // Creditor Account
            NodeList cdtrAcctList = rltdPtiesElement.getElementsByTagNameNS("*", "CdtrAcct");
            if (cdtrAcctList.getLength() > 0) {
                Element cdtrAcctElement = (Element) cdtrAcctList.item(0);
                NodeList ibanList = cdtrAcctElement.getElementsByTagNameNS("*", "IBAN");
                if (ibanList.getLength() > 0) {
                    payment.setCreditorAccount(ibanList.item(0).getTextContent());
                }
            }

            // Creditor Agent (Bank)
            NodeList cdtrAgtList = rltdPtiesElement.getElementsByTagNameNS("*", "CdtrAgt");
            if (cdtrAgtList.getLength() > 0) {
                Element cdtrAgtElement = (Element) cdtrAgtList.item(0);
                NodeList finInstnIdList = cdtrAgtElement.getElementsByTagNameNS("*", "FinInstnId");
                if (finInstnIdList.getLength() > 0) {
                    Element finInstnIdElement = (Element) finInstnIdList.item(0);
                    payment.setCreditorBankBic(getElementText(finInstnIdElement, "BIC"));
                }
            }
        }
    }

    /**
     * Helper method to get element text content by tag name
     */
    private String getElementText(Element parent, String tagName) {
        NodeList nodeList = parent.getElementsByTagNameNS("*", tagName);
        if (nodeList.getLength() > 0) {
            return nodeList.item(0).getTextContent();
        }
        return null;
    }

    /**
     * Parse ISO 8601 date-time string
     */
    private LocalDateTime parseDateTime(String dateTimeStr) {
        if (dateTimeStr == null || dateTimeStr.isEmpty()) {
            return null;
        }
        // Handle different ISO 8601 formats
        try {
            return LocalDateTime.parse(dateTimeStr, DateTimeFormatter.ISO_DATE_TIME);
        } catch (Exception e) {
            try {
                return LocalDateTime.parse(dateTimeStr.substring(0, 19));
            } catch (Exception ex) {
                return null;
            }
        }
    }

    /**
     * Parse ISO 8601 date string
     */
    private LocalDate parseDate(String dateStr) {
        if (dateStr == null || dateStr.isEmpty()) {
            return null;
        }
        try {
            return LocalDate.parse(dateStr, DateTimeFormatter.ISO_DATE);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Example usage
     */
    public static void main(String[] args) {
        if (args.length < 1) {
            System.out.println("Usage: java ISO20022Parser <xml-file-path>");
            return;
        }

        try {
            ISO20022Parser parser = new ISO20022Parser();
            AccountStatement statement = parser.parseFile(args[0]);

            System.out.println("=== Account Statement ===");
            System.out.println(statement);
            System.out.println("\n=== Payments ===");
            for (Payment payment : statement.getPayments()) {
                System.out.println(payment);
            }
        } catch (Exception e) {
            System.err.println("Error parsing file: " + e.getMessage());
            e.printStackTrace();
        }
    }
}
